import DefaultMap from "mnemonist/default-map.js";
import * as shlex from "shlex";
import assert from "tiny-invariant";
import type { SetRequired } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext, NetDefDN } from "../netdef-compose/mod.js";
import type { ComposeService, F5, N } from "../types/mod.js";
import { hexPad, scriptHead } from "../util/mod.js";
import * as f5_conf from "./conf.js";
import { dependOnGtp5g } from "./gtp5g.js";
import type * as W from "./webconsole-openapi/models/index.js";

function convertSNSSAI(input: string): F5.SNSSAI {
  const { sst, sd } = NetDef.splitSNSSAI(input).ih;
  assert(!!sd, "free5GC does not support S-NSSAI without SD value");
  return { sst, sd: sd.toLowerCase() };
}

class F5CPBuilder {
  constructor(protected readonly ctx: NetDefComposeContext) {
    this.plmn = NetDef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: F5.PLMNID;
  private readonly mongoUrl = new URL("mongodb://unset.invalid:27017");

  public async build(): Promise<void> {
    this.buildMongo();
    await this.buildNRF();
    await this.buildWebUI();
    await this.buildWebClient();
    await this.buildCHF();
    await this.buildUDR();
    await this.buildUDM();
    await this.buildAUSF();
    await this.buildNSSF();
    await this.buildPCF();
    await this.buildAMFs();
    await this.buildSMFs();
  }

  private buildMongo(): void {
    const s = this.ctx.defineService("mongo", compose.mongo.image, ["db"]);
    compose.mongo.init(s);
    this.mongoUrl.hostname = s.networks.db!.ipv4_address;
  }

  private async buildNRF(): Promise<void> {
    const [s, nrfcfg] = await this.defineService<F5.nrf.Configuration>("nrf", ["db", "cp"]);
    const c = nrfcfg.configuration;
    c.DefaultPlmnId = this.plmn;
    c.MongoDBUrl = this.mongoUrl.toString();

    s.command = [
      "./nrf",
      "-c", await this.saveConfig(s, "cp-cfg/nrf.yaml", "nrfcfg.yaml", nrfcfg),
    ];
  }

  private async buildWebUI(): Promise<void> {
    const [s, webuicfg] = await this.defineService<F5.webui.Configuration>("webui", ["mgmt", "db", "cp"]);
    const c = webuicfg.configuration;
    c.mongodb.url = this.mongoUrl.toString();
    c.webServer.ipv4Address = s.networks.mgmt!.ipv4_address;
    c.billingServer.hostIPv4 = s.networks.cp!.ipv4_address;

    s.command = [
      "./webui",
      "-c", await this.saveConfig(s, "cp-cfg/webui.yaml", "webuicfg.yaml", webuicfg),
    ];
  }

  private async buildWebClient(): Promise<void> {
    const serverIP = this.ctx.c.services.webui!.networks.mgmt!.ipv4_address;
    const serverPort = 5000;
    const server = `http://${serverIP}:${serverPort}`;
    const { netdef, network } = this.ctx;
    const plmnID = network.plmn.replace("-", "");

    const webconsole = await import("./webconsole-openapi/models/index.js");
    function* generateCommands() {
      yield* scriptHead;
      yield "msg Waiting for WebUI to become ready";
      yield `with_retry nc -z ${serverIP} ${serverPort}`;
      yield "sleep 1";
      yield "msg Requesting WebUI access token";
      yield `http --ignore-stdin -j POST ${server}/api/login username=admin password=free5gc | tee /login.json | jq .`;
      yield "TOKEN=\"$(jq -r .access_token /login.json)\"";
      for (const sub of netdef.listSubscribers({ expandCount: false })) {
        const smData = new DefaultMap<N.SNSSAI, Record<string, W.DnnConfiguration>>(() => ({}));
        const smPolicy: Record<string, SetRequired<W.SmPolicySnssai, "smPolicyDnnData">> = {};
        for (const { snssai, dnn } of sub.subscribedDN) {
          const dn = netdef.findDN(dnn, snssai);
          assert(dn);
          const { sst, sd = "FFFFFF" } = NetDef.splitSNSSAI(snssai).hex;
          const key = `${sst}${sd}`.toLowerCase();
          const sessionType = dn.type.toUpperCase();
          smData.get(key)[dnn] = {
            pduSessionTypes: {
              defaultSessionType: sessionType,
              allowedSessionTypes: [sessionType],
            },
            _5gQosProfile: {
              _5qi: 9,
              arp: { priorityLevel: 8 },
            },
            sessionAmbr: { uplink: "200 Mbps", downlink: "100 Mbps" },
          };
          (smPolicy[key] ??= {
            snssai: convertSNSSAI(snssai),
            smPolicyDnnData: {},
          }).smPolicyDnnData[dnn] = { dnn };
        }
        const j: W.Subscription = {
          plmnID,
          ueId: `imsi-${sub.supi}`,
          authenticationSubscription: {
            authenticationMethod: "5G_AKA",
            permanentKey: { permanentKeyValue: sub.k },
            authenticationManagementField: "8000",
            milenage: { op: { opValue: "" } },
            opc: { opcValue: sub.opc },
          },
          accessAndMobilitySubscriptionData: {
            gpsis: ["msisdn-"],
            subscribedUeAmbr: { uplink: "2 Gbps", downlink: "1 Gbps" },
            nssai: {
              defaultSingleNssais: sub.subscribedNSSAI.map(({ snssai }) => convertSNSSAI(snssai)),
            },
          },
          sessionManagementSubscriptionData: Array.from(smData, ([snssai, dnnConfigurations]) => ({
            singleNssai: convertSNSSAI(snssai),
            dnnConfigurations,
          })),
          smfSelectionSubscriptionData: undefined,
          amPolicyData: undefined,
          smPolicyData: { smPolicySnssaiData: smPolicy },
          flowRules: undefined,
          qosFlows: undefined,
        };
        const payload = JSON.stringify(webconsole.SubscriptionToJSON(j));
        if (sub.count > 1) {
          yield `msg Inserting UEs ${sub.supi}..${NetDef.listSUPIs(sub).at(-1)}`;
        } else {
          yield `msg Inserting UE ${sub.supi}`;
        }
        const url = `${server}/api/subscriber/imsi-${sub.supi}/${plmnID}/${sub.count}`;
        yield `echo ${shlex.quote(payload)} | http -j POST ${shlex.quote(url)} Token:"$TOKEN"`;
        yield "echo";
      }
      yield "msg Idling";
      yield "exec tail -f";
    }

    const s = this.ctx.defineService("webclient", "5gdeploy.localhost/free5gc-webclient", ["mgmt"]);
    await this.ctx.writeFile(
      "cp-cfg/webclient.sh",
      Array.from(generateCommands()).join("\n"),
      { s, target: "/action.sh" },
    );
    s.entrypoint = [];
    s.command = ["/bin/ash", "/action.sh"];
  }

  private async buildCHF(): Promise<void> {
    const [s, chfcfg] = await this.defineService<F5.chf.Configuration>("chf", ["db", "cp"]);
    const c = chfcfg.configuration;
    c.mongodb.url = this.mongoUrl.toString();
    c.cgf.hostIPv4 = this.ctx.c.services.webui!.networks.cp!.ipv4_address;
    c.abmfDiameter.hostIPv4 = s.networks.cp!.ipv4_address;
    c.rfDiameter.hostIPv4 = s.networks.cp!.ipv4_address;

    s.command = [
      "./chf",
      "-c", await this.saveConfig(s, "cp-cfg/chf.yaml", "chfcfg.yaml", chfcfg),
    ];
  }

  private async buildUDR(): Promise<void> {
    const [s, udrcfg] = await this.defineService<F5.udr.Configuration>("udr", ["db", "cp"]);
    const c = udrcfg.configuration;
    c.mongodb.url = this.mongoUrl.toString();

    s.command = [
      "./udr",
      "-c", await this.saveConfig(s, "cp-cfg/udr.yaml", "udrcfg.yaml", udrcfg),
    ];
  }

  private async buildUDM(): Promise<void> {
    const [s, udmcfg] = await this.defineService<F5.udm.Configuration>("udm", ["cp"]);
    s.command = [
      "./udm",
      "-c", await this.saveConfig(s, "cp-cfg/udm.yaml", "udmcfg.yaml", udmcfg),
    ];
  }

  private async buildAUSF(): Promise<void> {
    const [s, ausfcfg] = await this.defineService<F5.ausf.Configuration>("ausf", ["cp"]);
    const c = ausfcfg.configuration;
    c.plmnSupportList = [this.plmn];

    s.command = [
      "./ausf",
      "-c", await this.saveConfig(s, "cp-cfg/ausf.yaml", "ausfcfg.yaml", ausfcfg),
    ];
  }

  private async buildNSSF(): Promise<void> {
    const [s, nssfcfg] = await this.defineService<F5.nssf.Configuration>("nssf", ["cp"]);
    s.command = [
      "./nssf",
      "-c", await this.saveConfig(s, "cp-cfg/nssf.yaml", "nssfcfg.yaml", nssfcfg),
    ];
  }

  private async buildPCF(): Promise<void> {
    const [s, pcfcfg] = await this.defineService<F5.pcf.Configuration>("pcf", ["db", "cp"]);
    const c = pcfcfg.configuration;
    c.mongodb.url = this.mongoUrl.toString();

    s.command = [
      "./pcf",
      "-c", await this.saveConfig(s, "cp-cfg/pcf.yaml", "pcfcfg.yaml", pcfcfg),
    ];
  }

  private async buildAMFs(): Promise<void> {
    const { network, netdef } = this.ctx;
    for (const [ct, amf] of compose.suggestNames("amf", netdef.amfs)) {
      const [s, amfcfg] = await this.defineService<F5.amf.Configuration>(ct, ["cp", "n2"]);
      const c = amfcfg.configuration;
      c.ngapIpList = [s.networks.n2!.ipv4_address];

      const [region, set, pointer] = amf.amfi;
      const amfi = (BigInt(region) << 16n) | (BigInt(set) << 6n) | BigInt(pointer);
      c.servedGuamiList = [{
        plmnId: this.plmn,
        amfId: hexPad(amfi, 6),
      }];
      c.supportTaiList = [{
        plmnId: this.plmn,
        tac: network.tac,
      }];
      c.plmnSupportList = [{
        plmnId: this.plmn,
        snssaiList: netdef.nssai.map((snssai) => convertSNSSAI(snssai)),
      }];
      c.supportDnnList = network.dataNetworks.map((dn) => dn.dnn);

      s.command = [
        "./amf",
        "-c", await this.saveConfig(s, `cp-cfg/${ct}.yaml`, "amfcfg.yaml", amfcfg),
      ];
    }
  }

  private async buildSMFs(): Promise<void> {
    const { network, netdef } = this.ctx;
    const upi = this.buildSMFupi();
    for (const [ct, smf] of compose.suggestNames("smf", netdef.smfs)) {
      const [s, smfcfg] = await this.defineService<F5.smf.Configuration>(ct, ["cp", "n2", "n4"]);
      const uerouting = await f5_conf.loadTemplate("uerouting");

      const c = smfcfg.configuration;
      c.pfcp = {
        listenAddr: s.networks.n4!.ipv4_address,
        externalAddr: s.networks.n4!.ipv4_address,
        nodeID: s.networks.n4!.ipv4_address,
      };
      c.plmnList = [this.plmn];
      c.snssaiInfos = smf.nssai.map((snssai): F5.smf.SNSSAIInfo => ({
        sNssai: convertSNSSAI(snssai),
        dnnInfos: network.dataNetworks
          .filter((dn) => dn.snssai === snssai)
          .map((dn) => ({
            dnn: dn.dnn,
            dns: { ipv4: "1.1.1.1" },
          })),
      }));
      c.userplaneInformation = upi;
      c.nwInstFqdnEncoding = true;

      s.command = [
        "./smf",
        "-c", await this.saveConfig(s, `cp-cfg/${ct}.yaml`, "smfcfg.yaml", smfcfg),
        "-u", await this.saveConfig(s, `cp-cfg/${ct}.uerouting.yaml`, "uerouting.yaml", uerouting),
      ];
    }
  }

  private buildSMFupi(): F5.smf.UP {
    const { network, netdef } = this.ctx;
    const upi: F5.smf.UP = {
      upNodes: {},
      links: [],
    };

    let gnbPeers: [name: string, peersJoined: string, peers: readonly string[]] | undefined;
    for (const gnb of netdef.gnbs) {
      const peers: string[] = [];
      for (const [upfName] of netdef.listDataPathPeers(gnb.name)) {
        assert(typeof upfName === "string");
        peers.push(upfName);
      }
      peers.sort((a, b) => a.localeCompare(b));
      const peersJoined = peers.join(",");
      gnbPeers ??= [gnb.name, peersJoined, peers];
      if (gnbPeers[1] !== peersJoined) {
        throw new Error(`${gnb.name} peer list (${peersJoined}) differs from ${gnbPeers[0]} peer list ( ${gnbPeers[1]}), not supported by free5GC SMF`);
      }
    }
    if (gnbPeers) {
      upi.upNodes.GNB = {
        type: "AN",
      } satisfies F5.smf.UPNodeAN;
      upi.links.push(...gnbPeers[2].map((upfName): F5.smf.UPLink => ({ A: "GNB", B: upfName })));
    }

    for (const upf of network.upfs) {
      const upfService = this.ctx.c.services[upf.name];
      assert(upfService);
      const node: F5.smf.UPNodeUPF = {
        type: "UPF",
        nodeID: upfService.networks.n4!.ipv4_address,
        addr: upfService.networks.n4!.ipv4_address,
        sNssaiUpfInfos: [],
        interfaces: [],
      };
      upi.upNodes[upf.name] = node;

      const networkInstances: string[] = [];
      const dnBySNSSAI = new DefaultMap<string, F5.smf.UPFsnssai>((snssai) => {
        const info: F5.smf.UPFsnssai = {
          sNssai: convertSNSSAI(snssai),
          dnnUpfInfoList: [],
        };
        node.sNssaiUpfInfos.push(info);
        return info;
      });
      for (const [peer] of netdef.listDataPathPeers(upf.name)) {
        if (typeof peer === "string") {
          continue;
        }
        const dn = netdef.findDN(peer);
        assert(dn);
        if (dn.type !== "IPv4") {
          continue;
        }
        dnBySNSSAI.get(dn.snssai).dnnUpfInfoList.push({
          dnn: dn.dnn,
          pools: [{ cidr: dn.subnet! }],
        });
        networkInstances.push(peer.dnn);
      }

      for (const ifType of ["N3", "N9"] as const) {
        const upfNet = upfService.networks[ifType.toLowerCase()];
        if (!upfNet) {
          continue;
        }
        node.interfaces.push({
          interfaceType: ifType,
          endpoints: [upfNet.ipv4_address],
          networkInstances,
        });
      }
    }

    for (const { a, b } of netdef.dataPathLinks) {
      if (![a, b].every((node) => typeof node === "string" && compose.nameToNf(node) === "upf")) {
        continue;
      }
      upi.links.push({
        A: a as string,
        B: b as string,
      });
    }

    return upi;
  }

  private async defineService<C extends {}>(ct: string, nets: readonly string[]): Promise<[s: ComposeService, cfg: F5.Root<C>]> {
    const nf = compose.nameToNf(ct);
    const s = this.ctx.defineService(ct, await f5_conf.getTaggedImageName(nf), nets);
    s.stop_signal = "SIGQUIT";
    s.environment.GIN_MODE = "release";

    const cfg = await f5_conf.loadTemplate(`${nf}cfg`) as F5.Root<C>;

    const nameProp = `${nf}Name`;
    if (Object.hasOwn(cfg.configuration, nameProp)) {
      (cfg.configuration as any)[nameProp] = ct;
    }

    this.updateSBI(s, cfg.configuration as unknown as F5.SBI);
    return [s, cfg];
  }

  private updateSBI(s: ComposeService, c: F5.SBI): void {
    if (c.sbi !== undefined) {
      c.sbi = {
        scheme: "http",
        registerIPv4: s.networks.cp!.ipv4_address,
        bindingIPv4: s.networks.cp!.ipv4_address,
        port: 8000,
      };
    }

    if (c.nrfUri !== undefined) {
      const { nrf } = this.ctx.c.services;
      assert(!!nrf, "NRF is not yet created");
      c.nrfUri = `http://${nrf.networks.cp!.ipv4_address}:8000`;
    }
  }

  private async saveConfig(s: ComposeService, filename: string, mount: string, body: unknown): Promise<string> {
    await this.ctx.writeFile(filename, body, { s, target: `/free5gc/config/${mount}` });
    return `./config/${mount}`;
  }
}

/** Build CP functions using free5GC. */
export async function f5CP(ctx: NetDefComposeContext): Promise<void> {
  const b = new F5CPBuilder(ctx);
  await b.build();
}

/** Build UP functions using free5GC as UPF. */
export async function f5UP(ctx: NetDefComposeContext): Promise<void> {
  NetDefDN.defineDNServices(ctx);

  const dnnList: F5.upf.DN[] = ctx.network.dataNetworks.filter((dn) => dn.type === "IPv4").map((dn) => ({
    dnn: dn.dnn,
    cidr: dn.subnet!,
  }));

  for (const [ct, upf] of compose.suggestNames("upf", ctx.network.upfs)) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/free5gc-upf", ["n3", "n4", "n6", "n9"]);
    const peers = ctx.netdef.gatherUPFPeers(upf);
    compose.setCommands(s, [
      ...compose.renameNetifs(s, { pipeworkWait: true }),
      ...NetDefDN.makeUPFRoutes(ctx, peers),
      "msg Starting free5GC UPF",
      "exec ./upf -c ./config/upfcfg.yaml",
    ]);
    dependOnGtp5g(s, ctx.c);

    const c = await f5_conf.loadTemplate("upfcfg") as F5.upf.Root;
    c.pfcp.addr = s.networks.n4!.ipv4_address;
    c.pfcp.nodeID = s.networks.n4!.ipv4_address;
    // go-upf gtp5g driver listens on the first interface defined in ifList and does not distinguish N3 or N9
    // https://github.com/free5gc/go-upf/blob/efae7532f8f9ed081065cdaa0589b0c76d11b204/internal/forwarder/driver.go#L53-L58
    c.gtpu.ifList = [{
      addr: "0.0.0.0",
      type: "N3",
    }];
    c.dnnList = dnnList;

    await ctx.writeFile(`up-cfg/${ct}.yaml`, c, { s, target: "/free5gc/config/upfcfg.yaml" });
  }

  NetDefDN.setDNCommands(ctx);
}
