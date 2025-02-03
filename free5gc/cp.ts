import stringify from "json-stringify-deterministic";
import { DefaultMap } from "mnemonist";
import map from "obliterator/map.js";
import * as shlex from "shlex";

import { compose, http2Port, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, F5, N } from "../types/mod.js";
import { hexPad } from "../util/mod.js";
import * as f5_conf from "./conf.js";
import type { F5Opts } from "./options.js";
import type * as W from "./webconsole-openapi/models/index.js";

/** Build CP functions using free5GC. */
export async function f5CP(ctx: NetDefComposeContext, opts: F5Opts): Promise<void> {
  const b = new F5CPBuilder(ctx, opts);
  await b.build();
}

class F5CPBuilder {
  constructor(protected readonly ctx: NetDefComposeContext, protected readonly opts: F5Opts) {
    this.plmn = netdef.splitPLMN(ctx.network.plmn);
    this.plmnID = ctx.network.plmn.replace("-", "");
  }

  private readonly plmn: F5.PLMNID;
  private readonly plmnID: string;
  private readonly mongoUrl = compose.mongo.makeUrl();
  private nrfUri?: string;

  public async build(): Promise<void> {
    compose.mongo.define(this.ctx, { mongoUrl: this.mongoUrl });
    await this.buildNRF();
    await this.buildWebUI();
    await this.buildWebClient();
    await this.buildUDR();
    await this.buildUDM();
    await this.buildAUSF();
    await this.buildNSSF();
    await this.buildPCF();
    for (const amf of netdef.listAmfs(this.ctx.network)) {
      await this.buildAMF(amf);
    }
    for (const smf of netdef.listSmfs(this.ctx.network)) {
      await this.buildSMF(smf);
    }
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
    const server = new URL("http://unset.invalid:5000");
    server.hostname = serverIP;

    yield* compose.waitReachable("WebUI", [serverIP], { mode: `nc:${server.port as `${number}`}`, sleep: 1 });
    yield "msg Requesting WebUI access token";
    yield `http --ignore-stdin -j POST ${server}/api/login username=admin password=free5gc | tee /login.json | jq .`;
    yield "TOKEN=\"$(jq -r .access_token /login.json)\"";
    for (const sub of netdef.listSubscribers(this.ctx.network, { expandCount: false })) {
      const j = this.toSubscription(sub);
      const payload = stringify(webconsole.SubscriptionToJSON(j));
      if (sub.count > 1) {
        yield `msg Inserting UEs ${sub.supi}..${sub.supis.at(-1)}`;
      } else {
        yield `msg Inserting UE ${sub.supi}`;
      }
      const url = new URL(`/api/subscriber/imsi-${sub.supi}/${this.plmnID}/${sub.count}`, server);
      yield `echo ${shlex.quote(payload)} | http -j POST ${shlex.quote(url.toString())} Token:"$TOKEN"`;
      yield "echo";
    }
  }

  private toSubscription(sub: netdef.Subscriber): W.Subscription {
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
        subscribedUeAmbr: sub.ambr,
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
    for (const dnID of sub.subscribedDN) {
      const { dnn, snssai, sessionType, fiveQi, fiveQiPriorityLevel, arpLevel, ambr } = netdef.findDN(this.ctx.network, dnID);
      const { sst, sd = "" } = netdef.splitSNSSAI(snssai).hex;
      const key = `${sst}${sd}`.toLowerCase();

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
          _5qi: fiveQi,
          priorityLevel: fiveQiPriorityLevel,
          arp: { priorityLevel: arpLevel, preemptCap: "NOT_PREEMPT", preemptVuln: "NOT_PREEMPTABLE" },
        },
        sessionAmbr: ambr,
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
    // NSSF is unconfigured, because it is impossible to configure due to design oversight.
    // https://forum.free5gc.org/t/free5gc-oai-gnb-reroutenasrequest/2628?u=yoursunny
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

  private async buildAMF(amf: netdef.AMF): Promise<void> {
    const [s, amfcfg] = await this.defineService<F5.amf.Configuration>(amf.name, ["cp", "n2"]);
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
      tac: this.ctx.network.tac,
    }];
    c.plmnSupportList = [{
      plmnId: this.plmn,
      snssaiList: Array.from(netdef.listNssai(this.ctx.network), (snssai) => convertSNSSAI(snssai)),
    }];
    c.supportDnnList = this.ctx.network.dataNetworks.map((dn) => dn.dnn);

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      shlex.join([
        "./amf",
        "-c", await this.saveConfig(s, `cp-cfg/${amf.name}.yaml`, "amfcfg.yaml", amfcfg),
      ]),
    ], { shell: "ash" });
  }

  private async buildSMF(smf: netdef.SMF): Promise<void> {
    this.smfUpi ??= this.buildSMFupi();
    const [s, smfcfg] = await this.defineService<F5.smf.Configuration>(smf.name, ["cp", "n4"]);
    const uerouting = await f5_conf.loadTemplate("uerouting");

    const c = smfcfg.configuration;
    const n4 = compose.getIP(s, "n4");
    c.pfcp = {
      listenAddr: n4,
      externalAddr: n4,
      nodeID: n4,
    };
    c.userplaneInformation = this.smfUpi;
    c.snssaiInfos = smf.nssai.map((snssai): F5.smf.SNSSAIInfo => ({
      sNssai: convertSNSSAI(snssai),
      dnnInfos: this.ctx.network.dataNetworks
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
        "-c", await this.saveConfig(s, `cp-cfg/${smf.name}.yaml`, "smfcfg.yaml", smfcfg),
        "-u", await this.saveConfig(s, `cp-cfg/${smf.name}.uerouting.yaml`, "uerouting.yaml", uerouting),
      ]),
    ], { shell: "ash" });
  }

  private smfUpi?: F5.smf.UP;

  private buildSMFupi(): F5.smf.UP {
    const { network } = this.ctx;
    const upi: F5.smf.UP = {
      upNodes: {},
      links: [],
    };

    upi.upNodes.GNB = {
      type: "AN",
    } satisfies F5.smf.UPNodeAN;
    upi.links.push(...map(
      netdef.listDataPathPeers.ofGnbs(network),
      ([upf]): F5.smf.UPLink => ({ A: "GNB", B: upf }),
    ));

    for (const upf of netdef.listUpfs(network)) {
      const n4 = compose.getIP(this.ctx.c, upf.name, "n4");
      const node: F5.smf.UPNodeUPF = {
        type: "UPF",
        nodeID: n4,
        addr: n4,
        sNssaiUpfInfos: [],
        interfaces: [],
      };
      upi.upNodes[upf.name] = node;

      const networkInstances: string[] = [];
      const dnBySNSSAI = new DefaultMap<N.SNSSAI, F5.smf.UPFsnssai>((snssai) => {
        const info: F5.smf.UPFsnssai = {
          sNssai: convertSNSSAI(snssai),
          dnnUpfInfoList: [],
        };
        node.sNssaiUpfInfos.push(info);
        return info;
      });
      for (const { snssai, dnn, subnet } of upf.peers.N6IPv4) {
        dnBySNSSAI.get(snssai).dnnUpfInfoList.push({
          dnn,
          pools: [{ cidr: subnet! }],
        });
        networkInstances.push(dnn);
      }

      for (const ifType of ["N3", "N9"] as const) {
        let addr: string;
        try {
          addr = compose.getIP(this.ctx.c, upf.name, ifType.toLowerCase());
        } catch {
          continue;
        }
        node.interfaces.push({
          interfaceType: ifType,
          endpoints: [addr],
          networkInstances,
        });
      }
    }

    for (const [a, b] of network.dataPaths) {
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
    const s = this.ctx.defineService(ct, await f5_conf.getTaggedImageName(this.opts, nf), nets);
    f5_conf.mountTmpfsVolumes(s);
    s.stop_signal = "SIGQUIT";
    s.environment.GIN_MODE = "release";

    const cfg = await f5_conf.loadTemplate(`${nf}cfg`) as F5.Root<C>;

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
        port: http2Port,
      };
    }

    if ("nrfUri" in c) {
      this.nrfUri ??= (() => {
        const u = new URL("http://unset.invalid");
        u.hostname = compose.getIP(this.ctx.c, "nrf", "cp");
        u.port = `${http2Port}`;
        return u.toString().replace(/\/$/, ""); // trailing '/' causes NRF to return HTTP 404
      })();
      c.nrfUri = this.nrfUri;
    }
  }

  private async saveConfig(s: ComposeService, filename: string, mount: string, body: unknown): Promise<string> {
    await this.ctx.writeFile(filename, body, { s, target: `/free5gc/config/${mount}` });
    return `./config/${mount}`;
  }
}

function convertSNSSAI(input: string): F5.SNSSAI {
  const { sst, sd } = netdef.splitSNSSAI(input).ih;
  return { sst, sd: sd?.toLowerCase() };
}
