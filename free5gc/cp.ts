import DefaultMap from "mnemonist/default-map.js";
import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, F5, N } from "../types/mod.js";
import { assert, hexPad } from "../util/mod.js";
import { convertSNSSAI, getTaggedImageName, loadTemplate, mountTmpfsVolumes } from "./conf.js";
import type * as W from "./webconsole-openapi/models/index.js";

/** Build CP functions using free5GC. */
export async function f5CP(ctx: NetDefComposeContext): Promise<void> {
  const b = new F5CPBuilder(ctx);
  await b.build();
}

class F5CPBuilder {
  constructor(protected readonly ctx: NetDefComposeContext) {
    this.plmn = NetDef.splitPLMN(ctx.network.plmn);
    this.plmnID = ctx.network.plmn.replace("-", "");
  }

  private readonly plmn: F5.PLMNID;
  private readonly plmnID: string;
  private readonly mongoUrl = new URL("mongodb://unset.invalid:27017");
  private nrfUrl?: string;

  public async build(): Promise<void> {
    this.buildMongo();
    await this.buildNRF();
    await this.buildWebUI();
    await this.buildWebClient();
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
    this.mongoUrl.hostname = compose.getIP(s, "db");
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
    c.webServer.ipv4Address = compose.getIP(s, "mgmt");
    c.billingServer.hostIPv4 = compose.getIP(s, "cp");

    s.command = [
      "./webui",
      "-c", await this.saveConfig(s, "cp-cfg/webui.yaml", "webuicfg.yaml", webuicfg),
    ];
  }

  private async buildWebClient(): Promise<void> {
    const webconsole = await import("./webconsole-openapi/models/index.js");
    const serverIP = compose.getIP(this.ctx.c, "webui", "mgmt");
    const s = this.ctx.defineService("webclient", "5gdeploy.localhost/free5gc-webclient", ["mgmt"]);
    await compose.setCommandsFile(
      this.ctx, s, this.generateWebClientCommands(webconsole, serverIP),
      { shell: "ash", filename: "cp-cfg/webclient.sh" },
    );
  }

  private *generateWebClientCommands(webconsole: typeof W, serverIP: string): Iterable<string> {
    const serverPort = 5000;
    const server = `http://${serverIP}:${serverPort}`;

    yield* compose.waitReachable("WebUI", [serverIP], { mode: `nc:${serverPort}`, sleep: 1 });
    yield "msg Requesting WebUI access token";
    yield `http --ignore-stdin -j POST ${server}/api/login username=admin password=free5gc | tee /login.json | jq .`;
    yield "TOKEN=\"$(jq -r .access_token /login.json)\"";
    for (const sub of this.ctx.netdef.listSubscribers({ expandCount: false })) {
      const j = this.toSubscription(sub);
      const payload = JSON.stringify(webconsole.SubscriptionToJSON(j));
      if (sub.count > 1) {
        yield `msg Inserting UEs ${sub.supi}..${NetDef.listSUPIs(sub).at(-1)}`;
      } else {
        yield `msg Inserting UE ${sub.supi}`;
      }
      const url = `${server}/api/subscriber/imsi-${sub.supi}/${this.plmnID}/${sub.count}`;
      yield `echo ${shlex.quote(payload)} | http -j POST ${shlex.quote(url)} Token:"$TOKEN"`;
      yield "echo";
    }
  }

  private toSubscription(sub: NetDef.Subscriber): W.Subscription {
    const j: W.Subscription = {
      plmnID: this.plmnID,
      ueId: `imsi-${sub.supi}`,
      authenticationSubscription: {
        authenticationMethod: "5G_AKA",
        permanentKey: {
          permanentKeyValue: sub.k,
          encryptionKey: 0,
          encryptionAlgorithm: 0,
        },
        sequenceNumber: "000000000023",
        authenticationManagementField: "8000",
        milenage: {},
        opc: {
          opcValue: sub.opc,
          encryptionKey: 0,
          encryptionAlgorithm: 0,
        },
      },
      accessAndMobilitySubscriptionData: {
        gpsis: ["msisdn-"],
        subscribedUeAmbr: { uplink: "2 Gbps", downlink: "1 Gbps" },
        nssai: {
          defaultSingleNssais: sub.subscribedNSSAI.map(({ snssai }) => convertSNSSAI(snssai)),
        },
      },
      sessionManagementSubscriptionData: [],
      smfSelectionSubscriptionData: {
        subscribedSnssaiInfos: {},
      },
      amPolicyData: {},
      smPolicyData: {
        smPolicySnssaiData: {},
      },
      flowRules: [],
      qosFlows: [],
      chargingDatas: [],
    };

    const smDatas: Record<N.SNSSAI, W.SessionManagementSubscriptionData> = {};
    for (const { snssai, dnn } of sub.subscribedDN) {
      const dn = this.ctx.netdef.findDN(dnn, snssai);
      assert(dn);
      const { sst, sd = "" } = NetDef.splitSNSSAI(snssai).hex;
      const key = `${sst}${sd}`.toLowerCase();
      const sessionType = dn.type.toUpperCase();

      let smData = smDatas[snssai];
      if (!smData) {
        smData = {
          singleNssai: convertSNSSAI(snssai),
          dnnConfigurations: {},
        };
        smDatas[snssai] = smData;
        j.sessionManagementSubscriptionData.push(smData);
      }
      smData.dnnConfigurations![dnn] = {
        pduSessionTypes: {
          defaultSessionType: sessionType,
          allowedSessionTypes: [sessionType],
        },
        sscModes: {
          defaultSscMode: "SSC_MODE_1",
          allowedSscModes: ["SSC_MODE_2", "SSC_MODE_3"],
        },
        _5gQosProfile: {
          _5qi: 9,
          arp: { priorityLevel: 8, preemptCap: "", preemptVuln: "" },
          priorityLevel: 8,
        },
        sessionAmbr: {
          downlink: "1000 Mbps",
          uplink: "1000 Mbps",
        },
      };

      (j.smfSelectionSubscriptionData.subscribedSnssaiInfos![key] ??= {
        dnnInfos: [],
      }).dnnInfos.push({ dnn });

      (j.smPolicyData.smPolicySnssaiData[key] ??= {
        snssai: convertSNSSAI(snssai),
        smPolicyDnnData: {},
      }).smPolicyDnnData![dnn] = { dnn };
    }

    return j;
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
      c.ngapIpList = [compose.getIP(s, "n2")];

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

      compose.setCommands(s, [
        ...compose.renameNetifs(s),
        shlex.join([
          "./amf",
          "-c", await this.saveConfig(s, `cp-cfg/${ct}.yaml`, "amfcfg.yaml", amfcfg),
        ]),
      ], { shell: "ash" });
    }
  }

  private async buildSMFs(): Promise<void> {
    const { network, netdef } = this.ctx;
    const upi = this.buildSMFupi();
    for (const [ct, smf] of compose.suggestNames("smf", netdef.smfs)) {
      const [s, smfcfg] = await this.defineService<F5.smf.Configuration>(ct, ["cp", "n4"]);
      const uerouting = await loadTemplate("uerouting");

      const c = smfcfg.configuration;
      c.pfcp = {
        listenAddr: compose.getIP(s, "n4"),
        externalAddr: compose.getIP(s, "n4"),
        nodeID: compose.getIP(s, "n4"),
      };
      c.userplaneInformation = upi;
      c.snssaiInfos = smf.nssai.map((snssai): F5.smf.SNSSAIInfo => ({
        sNssai: convertSNSSAI(snssai),
        dnnInfos: network.dataNetworks
          .filter((dn) => dn.snssai === snssai)
          .map((dn) => ({
            dnn: dn.dnn,
            dns: { ipv4: "1.1.1.1" },
          })),
      }));
      c.plmnList = [this.plmn];
      delete c.urrPeriod;
      delete c.urrThreshold;
      c.nwInstFqdnEncoding = true;

      compose.setCommands(s, [
        ...compose.renameNetifs(s),
        shlex.join([
          "./smf",
          "-c", await this.saveConfig(s, `cp-cfg/${ct}.yaml`, "smfcfg.yaml", smfcfg),
          "-u", await this.saveConfig(s, `cp-cfg/${ct}.uerouting.yaml`, "uerouting.yaml", uerouting),
        ]),
      ], { shell: "ash" });
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
        throw new Error(`${gnb.name} peer list (${peersJoined}) differs from ${gnbPeers[0]} peer list (${gnbPeers[1]}), not supported by free5GC SMF`);
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
        nodeID: compose.getIP(upfService, "n4"),
        addr: compose.getIP(upfService, "n4"),
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

  private async defineService<C extends F5.SBI>(ct: string, nets: readonly string[]): Promise<[s: ComposeService, cfg: F5.Root<C>]> {
    const nf = compose.nameToNf(ct);
    const s = this.ctx.defineService(ct, await getTaggedImageName(nf), nets);
    mountTmpfsVolumes(s);
    s.stop_signal = "SIGQUIT";
    s.environment.GIN_MODE = "release";

    const cfg = await loadTemplate(`${nf}cfg`) as F5.Root<C>;

    const nameProp = `${nf}Name`;
    if (Object.hasOwn(cfg.configuration, nameProp)) {
      (cfg.configuration as any)[nameProp] = ct;
    }

    this.updateSBI(s, cfg.configuration);
    return [s, cfg];
  }

  private updateSBI(s: ComposeService, c: F5.SBI): void {
    if ("sbi" in c) {
      const cpIP = compose.getIP(s, "cp");
      c.sbi = {
        scheme: "http",
        registerIPv4: cpIP,
        bindingIPv4: cpIP,
        port: 8000,
      };
    }

    if ("nrfUri" in c) {
      this.nrfUrl ??= (() => {
        const u = new URL("http://unset.invalid:8000");
        u.hostname = compose.getIP(this.ctx.c, "nrf", "cp");
        return u.toString().replace(/\/$/, ""); // trailing '/' causes NRF to return HTTP 404
      })();
      c.nrfUri = this.nrfUrl;
    }
  }

  private async saveConfig(s: ComposeService, filename: string, mount: string, body: unknown): Promise<string> {
    await this.ctx.writeFile(filename, body, { s, target: `/free5gc/config/${mount}` });
    return `./config/${mount}`;
  }
}
