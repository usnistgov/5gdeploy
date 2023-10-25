import assert from "minimalistic-assert";
import DefaultMap from "mnemonist/default-map.js";
import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import * as NetDefDN from "../netdef-compose/dn.js";
import type { ComposeService } from "../types/compose.js";
import type * as F5 from "../types/free5gc.js";
import type * as N from "../types/netdef.js";
import * as f5_conf from "./conf.js";
import type * as W from "./webconsole-openapi/models/index.js";

function convertSNSSAI(input: string): F5.SNSSAI {
  const { int: { sst }, hex: { sd = "FFFFFF" } } = NetDef.splitSNSSAI(input);
  return { sst, sd };
}

class F5CPBuilder {
  constructor(protected readonly ctx: NetDefComposeContext) {
    const [mcc, mnc] = NetDef.splitPLMN(ctx.network.plmn);
    this.plmn = { mcc, mnc };
  }

  private readonly plmn: F5.PLMNID;
  private readonly mongoUrl = new URL("mongodb://unset.invalid:27017");

  public async build(): Promise<void> {
    this.buildMongo();
    await this.buildWebUI();
    await this.buildWebClient();
    await this.buildNRF();
    await this.buildUDR();
    await this.buildUDM();
    await this.buildAUSF();
    await this.buildNSSF();
    await this.buildPCF();
    await this.buildAMFs();
    await this.buildSMFs();
  }

  private buildMongo(): void {
    const s = this.ctx.defineService("mongo", "mongo", ["db"]);
    this.mongoUrl.hostname = s.networks.db!.ipv4_address;
  }

  private async buildWebUI(): Promise<void> {
    const [s, webuicfg] = this.defineService<F5.webui.Configuration>("webui", ["mgmt", "db"]);
    const c = webuicfg.configuration;
    c.mongodb.url = this.mongoUrl.toString();

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
    const s = this.ctx.defineService("webclient", "alpine/httpie", ["mgmt"]);
    const webconsole = await import("./webconsole-openapi/models/index.js");
    compose.setCommands(s, (function*() {
      yield "msg Waiting for WebUI to become ready";
      yield `while ! nc -z ${serverIP} ${serverPort}; do sleep 0.2; done`;
      yield "sleep 1";
      for (const sub of netdef.listSubscribers(false)) {
        const smData = new DefaultMap<N.SNSSAI, Record<string, W.DnnConfiguration>>(() => ({}));
        const smPolicy: Record<string, W.SmPolicySnssai> = {};
        for (const { snssai, dnn } of sub.subscribedDN) {
          const dn = netdef.findDN(dnn, snssai);
          assert(dn);
          const { hex: { sst, sd = "FFFFFF" } } = NetDef.splitSNSSAI(snssai);
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
          smPolicy[key] ??= {
            snssai: convertSNSSAI(snssai),
            smPolicyDnnData: {},
          };
          smPolicy[key]!.smPolicyDnnData![dnn] = { dnn };
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
        const payload = shlex.quote(JSON.stringify(webconsole.SubscriptionToJSON(j)));
        yield `msg Inserting UE ${sub.supi}`;
        yield `echo ${payload} | http -j POST ${server}/api/subscriber/imsi-${sub.supi}/${plmnID}/${sub.count} Token:admin`;
        yield "echo";
      }
      yield "msg Idling";
      yield "exec tail -f";
    })(), "ash");
  }

  private async buildNRF(): Promise<void> {
    const [s, nrfcfg] = this.defineService<F5.nrf.Configuration>("nrf", ["db", "cp"]);
    const c = nrfcfg.configuration;
    c.DefaultPlmnId = this.plmn;
    c.MongoDBUrl = this.mongoUrl.toString();

    s.command = [
      "./nrf",
      "-c", await this.saveConfig(s, "cp-cfg/nrf.yaml", "nrfcfg.yaml", nrfcfg),
    ];
  }

  private async buildUDR(): Promise<void> {
    const [s, udrcfg] = this.defineService<F5.udr.Configuration>("udr", ["db", "cp"]);
    const c = udrcfg.configuration;
    c.mongodb.url = this.mongoUrl.toString();

    s.command = [
      "./udr",
      "-c", await this.saveConfig(s, "cp-cfg/udr.yaml", "udrcfg.yaml", udrcfg),
    ];
  }

  private async buildUDM(): Promise<void> {
    const [s, udmcfg] = this.defineService<F5.udm.Configuration>("udm", ["cp"]);
    s.command = [
      "./udm",
      "-c", await this.saveConfig(s, "cp-cfg/udm.yaml", "udmcfg.yaml", udmcfg),
    ];
  }

  private async buildAUSF(): Promise<void> {
    const [s, ausfcfg] = this.defineService<F5.ausf.Configuration>("ausf", ["cp"]);
    const c = ausfcfg.configuration;
    c.plmnSupportList = [this.plmn];

    s.command = [
      "./ausf",
      "-c", await this.saveConfig(s, "cp-cfg/ausf.yaml", "ausfcfg.yaml", ausfcfg),
    ];
  }

  private async buildNSSF(): Promise<void> {
    const [s, nssfcfg] = this.defineService<F5.nssf.Configuration>("nssf", ["cp"]);
    s.command = [
      "./nssf",
      "-c", await this.saveConfig(s, "cp-cfg/nssf.yaml", "nssfcfg.yaml", nssfcfg),
    ];
  }

  private async buildPCF(): Promise<void> {
    const [s, pcfcfg] = this.defineService<F5.pcf.Configuration>("pcf", ["db", "cp"]);
    const c = pcfcfg.configuration;
    c.mongodb.url = this.mongoUrl.toString();

    s.command = [
      "./pcf",
      "-c", await this.saveConfig(s, "cp-cfg/pcf.yaml", "pcfcfg.yaml", pcfcfg),
    ];
  }

  private async buildAMFs(): Promise<void> {
    const { network, netdef } = this.ctx;
    for (const [ct, amf] of compose.suggestNames("amf", network.amfs)) {
      const [s, amfcfg] = this.defineService<F5.amf.Configuration>(ct, ["cp", "n2"]);
      const c = amfcfg.configuration;
      c.amfName = amf.name;
      c.ngapIpList = [s.networks.n2!.ipv4_address];

      const [region, set, pointer] = amf.amfi;
      const amfi = (BigInt(region) << 16n) | (BigInt(set) << 6n) | BigInt(pointer);
      c.servedGuamiList = [{
        plmnId: this.plmn,
        amfId: amfi.toString(16).padStart(6, "0"),
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
    for (const [ct, smf] of compose.suggestNames("smf", network.smfs)) {
      const [s, smfcfg] = this.defineService<F5.smf.Configuration>(ct, ["cp", "n2", "n4"]);
      const uerouting = f5_conf.loadTemplate("uerouting");

      const c = smfcfg.configuration;
      c.smfName = smf.name;
      c.pfcp = {
        listenAddr: s.networks.n4!.ipv4_address,
        externalAddr: s.networks.n4!.ipv4_address,
        nodeID: s.networks.n4!.ipv4_address,
      };
      c.plmnList = [this.plmn];
      c.snssaiInfos = netdef.nssai.map((snssai): F5.smf.SNSSAIInfo => ({
        sNssai: convertSNSSAI(snssai),
        dnnInfos: network.dataNetworks
          .filter((dn) => dn.snssai === snssai)
          .map((dn) => ({
            dnn: dn.dnn,
            dns: { ipv4: "1.1.1.1" },
          })),
      }));
      c.userplaneInformation = this.buildSMFupi();

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
    for (const gnb of network.gnbs) {
      const peers: string[] = [];
      for (const [upfName] of netdef.listDataPathPeers(gnb.name)) {
        assert(typeof upfName === "string");
        peers.push(upfName);
      }
      const peersJoined = peers.sort((a, b) => a.localeCompare(b)).join(",");
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

  private defineService<C extends {}>(ct: string, nets: readonly string[]): [s: ComposeService, cfg: F5.Root<C>] {
    const nf = compose.nameToNf(ct);
    const s = this.ctx.defineService(ct, f5_conf.getImage(nf), nets);
    s.environment.GIN_MODE = "release";
    const cfg = f5_conf.loadTemplate(`${nf}cfg`) as F5.Root<C>;
    if ((cfg.configuration as unknown as F5.SBI).sbi !== undefined) {
      this.updateSBI(s, cfg.configuration as unknown as F5.SBI);
    }
    return [s, cfg];
  }

  private updateSBI(s: ComposeService, c: F5.SBI): void {
    c.sbi = {
      scheme: "http",
      registerIPv4: s.networks.cp!.ipv4_address,
      bindingIPv4: s.networks.cp!.ipv4_address,
      port: 8000,
    };

    if (c.nrfUri !== undefined) {
      c.nrfUri = `http://${this.ctx.c.services.nrf!.networks.cp!.ipv4_address}:8000`;
    }
  }

  private async saveConfig(s: ComposeService, filename: string, mount: string, body: unknown): Promise<string> {
    await this.ctx.writeFile(filename, body);
    s.volumes.push({
      type: "bind",
      source: `./${filename}`,
      target: `/free5gc/config/${mount}`,
      read_only: true,
    });
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
      "exec ./upf -c ./config/upfcfg.yaml",
    ]);
    const yamlFile = `up-cfg/${ct}.yaml`;
    s.volumes.push({
      type: "bind",
      source: `./${yamlFile}`,
      target: "/free5gc/config/upfcfg.yaml",
      read_only: true,
    });
    s.cap_add = ["NET_ADMIN"];

    const c = f5_conf.loadTemplate("upfcfg") as F5.upf.Root;
    c.pfcp.addr = s.networks.n4!.ipv4_address;
    c.pfcp.nodeID = s.networks.n4!.ipv4_address;
    // go-upf gtp5g driver listens on the first interface defined in ifList and does not distinguish N3 or N9
    // https://github.com/free5gc/go-upf/blob/efae7532f8f9ed081065cdaa0589b0c76d11b204/internal/forwarder/driver.go#L53-L58
    c.gtpu.ifList = [{
      addr: "0.0.0.0",
      type: "N3",
    }];
    c.dnnList = dnnList;

    await ctx.writeFile(yamlFile, c);
  }

  NetDefDN.setDNCommands(ctx);
}
