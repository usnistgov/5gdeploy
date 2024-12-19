import * as shlex from "shlex";
import type { PartialDeep } from "type-fest";

import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, N, O5G } from "../types/mod.js";
import { dbctlDockerImage, makeLaunchCommands, makeMetrics, makeSockNode, o5DockerImage, webuiDockerImage } from "./common.js";

/** Build CP functions using Open5GS. */
export async function o5CP(ctx: NetDefComposeContext): Promise<void> {
  const b = new O5CPBuilder(ctx);
  b.build();
}

class O5CPBuilder {
  constructor(protected readonly ctx: NetDefComposeContext) {
    this.plmn = netdef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: O5G.PLMNID;
  private readonly mongoUrl = compose.mongo.makeUrl("open5gs");
  private waitNrf: string[] = [];
  private nrfUri?: string;

  public build(): void {
    compose.mongo.define(this.ctx, this.mongoUrl);
    this.buildPopulate();
    this.buildNRF();
    this.defineOnlySbi("udr", ["db"]); // needed by UDM
    this.defineOnlySbi("udm"); // needed by AUSF
    this.defineOnlySbi("ausf"); // needed by AMF
    this.defineOnlySbi("bsf"); // needed by PCF
    this.buildPCF(); // needed by AMF
    this.buildNSSF(); // needed by AMF
    for (const amf of netdef.listAmfs(this.ctx.network)) {
      this.buildAMF(amf);
    }
    for (const smf of netdef.listSmfs(this.ctx.network)) {
      this.buildSMF(smf);
    }
    this.buildWebUI();
  }

  private buildPopulate(): void {
    const s = this.defineService("populate", dbctlDockerImage, ["db"]);
    s.depends_on.mongo = { condition: "service_started" };

    compose.setCommands(s, makeDbctlCommands(this.ctx.network));
  }

  private buildNRF(): void {
    const s = this.defineService("nrf", ["cp"]);

    const cfg: PartialDeep<O5G.nrf.Root> = {
      nrf: {
        sbi: this.makeSBI(s),
        serving: [{
          plmn_id: this.plmn,
        }],
      },
      time: {
        nf_instance: { heartbeat: 0 },
      },
    };

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...makeLaunchCommands("nrf", cfg),
    ]);
  }

  private buildPCF(): void {
    const s = this.defineService("pcf", ["mgmt", "db", "cp"]);

    const cfg: PartialDeep<O5G.pcf.Root> = {
      pcf: {
        sbi: this.makeSBI(s),
        metrics: makeMetrics(s),
      },
    };

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...this.waitNrf,
      ...makeLaunchCommands("pcf", cfg),
    ]);
  }

  private buildNSSF(): void {
    const s = this.defineService("nssf", ["cp"]);

    const cfg: PartialDeep<O5G.nssf.Root> = {
      nssf: {
        sbi: this.makeSBI(s),
      },
    };
    cfg.nssf!.sbi!.client!.nsi = Array.from(netdef.listNssai(this.ctx.network), (snssai) => ({
      uri: this.nrfUri!.toString(),
      s_nssai: netdef.splitSNSSAI(snssai).ih,
    }));

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...this.waitNrf,
      ...makeLaunchCommands("nssf", cfg),
    ]);
  }

  private buildAMF(amf: netdef.AMF): void {
    const s = this.defineService(amf.name, ["mgmt", "cp", "n2"]);

    const cfg: PartialDeep<O5G.amf.Root> = {
      amf: {
        sbi: this.makeSBI(s),
        ngap: { server: [makeSockNode(s, "n2")] },
        metrics: makeMetrics(s),
        guami: [{
          plmn_id: this.plmn,
          amf_id: {
            region: amf.amfi[0],
            set: amf.amfi[1],
            pointer: amf.amfi[2],
          },
        }],
        tai: [{
          plmn_id: this.plmn,
          tac: [Number.parseInt(this.ctx.network.tac, 16)],
        }],
        plmn_support: [{
          plmn_id: this.plmn,
          s_nssai: Array.from(netdef.listNssai(this.ctx.network), (snssai) => netdef.splitSNSSAI(snssai).ih),
        }],
        amf_name: amf.name,
      },
    };

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...this.waitNrf,
      ...makeLaunchCommands(amf.name, cfg),
    ]);
  }

  private buildSMF(smf: netdef.SMF): void {
    const s = this.defineService(smf.name, ["mgmt", "cp", "n4"]);

    const cfg: PartialDeep<O5G.smf.Root> = {
      smf: {
        info: [{
          s_nssai: Array.from(smf.nssai, (snssai) => {
            const dnn = Array.from(
              this.ctx.network.dataNetworks.filter((dn) => dn.snssai === snssai),
              ({ dnn }) => dnn,
            );
            return { ...netdef.splitSNSSAI(snssai).ih, dnn };
          }),
        }],
        sbi: this.makeSBI(s),
        pfcp: {
          server: [makeSockNode(s, "n4")],
          client: {
            upf: Array.from(this.ctx.network.upfs, (upf): O5G.smf.PfcpUpf => {
              const peers = netdef.gatherUPFPeers(this.ctx.network, upf);
              return {
                address: compose.getIP(this.ctx.c, upf.name, "n4"),
                dnn: Array.from([...peers.N6IPv4, ...peers.N6IPv6], ({ dnn }) => dnn),
              };
            }),
          },
        },
        gtpu: { server: [makeSockNode(s, "n4")] },
        session: Array.from(
          this.ctx.network.dataNetworks.filter(({ type }) => type.startsWith("IP")),
          ({ subnet, dnn }) => ({ subnet: subnet!, dnn }),
        ),
        metrics: makeMetrics(s),
      },
    };

    const dels = [
      ".smf.freeDiameter",
      ".smf.gtpc",
      ".smf.sbi.client.scp",
    ];

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...this.waitNrf,
      ...makeLaunchCommands(smf.name, cfg, { dels }),
    ]);
  }

  private buildWebUI(): void {
    const s = this.defineService("webui", webuiDockerImage, ["mgmt", "db"]);
    s.environment.NODE_ENV = "dev"; // needed for automatic account creation
  }

  private defineService(ct: string, nets: readonly string[]): ComposeService;
  private defineService(ct: string, image: string, nets: readonly string[]): ComposeService;
  private defineService(ct: string, arg2: unknown, arg3?: unknown): ComposeService {
    const [image, nets] = (Array.isArray(arg2) ? [o5DockerImage, arg2] : [arg2, arg3]) as [string, readonly string[]];
    const s = this.ctx.defineService(ct, image, nets);
    s.stop_signal = "SIGTERM";
    if (nets.includes("db")) {
      s.environment.DB_URI = this.mongoUrl.toString();
    }
    return s;
  }

  private defineOnlySbi(ct: string, nets: readonly string[] = []): ComposeService {
    const nf = compose.nameToNf(ct);
    const s = this.defineService(ct, ["cp", ...nets]);

    const cfg = {
      [nf]: {
        sbi: this.makeSBI(s),
      },
    };

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...this.waitNrf,
      ...makeLaunchCommands(ct, cfg),
    ]);
    return s;
  }

  private makeSBI(s: ComposeService): PartialDeep<O5G.SBI> {
    const port = 8000;
    const sbi: PartialDeep<O5G.SBI> = {
      server: [makeSockNode(s, "cp", port)],
    };

    if (s.container_name === "nrf") {
      const u = new URL("http://unset.invalid");
      u.hostname = compose.getIP(s, "cp");
      u.port = `${port}`;
      this.nrfUri = u.toString();

      this.waitNrf = Array.from(compose.waitReachable(
        "NRF", [u.hostname], { mode: `tcp:${port}`, sleep: 0 },
      ));
    } else {
      sbi.client = {
        scp: [],
        nrf: [{ uri: this.nrfUri! }],
      };
    }

    return sbi;
  }
}

function* makeDbctlCommands(network: N.Network) {
  yield "open5gs-dbctl reset";
  for (const { supi, k, opc, subscribedNSSAI, dlAmbr, ulAmbr } of netdef.listSubscribers(network)) {
    for (const [i, { snssai, dnns }] of subscribedNSSAI.entries()) {
      const { sst, sd } = netdef.splitSNSSAI(snssai, true).ih;
      for (const [j, dnn] of dnns.entries()) {
        if (j > 0) {
          yield shlex.join(["open5gs-dbctl", "update_apn", supi, dnn, `${i}`]);
        } else if (i > 0) {
          yield shlex.join(["open5gs-dbctl", "update_slice", supi, dnn, `${sst}`, sd]);
        } else {
          yield shlex.join(["open5gs-dbctl", "add_ue_with_slice", supi, k, opc, dnn, `${sst}`, sd]);
          yield shlex.join(["open5gs-dbctl", "ambr_speed", supi, `${Math.trunc(dlAmbr * 1e3)}`, "1", `${Math.trunc(ulAmbr * 1e3)}`, "1"]);
        }
      }
    }
  }
  yield "open5gs-dbctl showpretty";
}
