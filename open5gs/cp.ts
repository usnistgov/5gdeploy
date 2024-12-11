import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import { oaiCP } from "../oai/cn5g.js";
import { oaiOptions } from "../oai/options.js";
import type { ComposeService, N, O5G } from "../types/mod.js";
import { YargsDefaults } from "../util/yargs.js";
import { makeLaunchCommands, makeMetrics, makeSockNode, o5DockerImage } from "./common.js";

/** Build CP functions using Open5GS. */
export async function o5CP(ctx: NetDefComposeContext): Promise<void> {
  await oaiCP(ctx, YargsDefaults(oaiOptions));

  const b = new O5CPBuilder(ctx);
  await b.build();
}

class O5CPBuilder {
  constructor(protected readonly ctx: NetDefComposeContext) {
    this.plmn = NetDef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: O5G.PLMNID;
  private nrfUri?: string;

  public async build(): Promise<void> {
    this.buildNRF();
    for (const amf of this.ctx.netdef.amfs) {
      this.buildAMF(amf);
    }
    for (const smf of this.ctx.netdef.smfs) {
      this.buildSMF(smf);
    }
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

    const u = new URL("http://invalid:8080");
    u.hostname = compose.getIP(s, "cp");
    this.nrfUri = u.toString();
  }

  private buildAMF(amf: Required<N.AMF>): void {
    const s = this.defineService(amf.name, ["mgmt", "cp"]);
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
          tac: [this.ctx.netdef.tac],
        }],
        plmn_support: [{
          plmn_id: this.plmn,
          s_nssai: Array.from(
            this.ctx.netdef.nssai,
            (snssai) => NetDef.splitSNSSAI(snssai).ih,
          ),
        }],
        amf_name: amf.name,
      },
    };
    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...makeLaunchCommands(amf.name, cfg),
    ]);
  }

  private buildSMF(smf: Required<N.SMF>): void {
    const s = this.defineService(smf.name, ["mgmt", "cp", "n4"]);
    const cfg: PartialDeep<O5G.smf.Root> = {
      smf: {
        info: [{
          s_nssai: Array.from(smf.nssai, (snssai) => {
            const dnn = Array.from(
              this.ctx.network.dataNetworks.filter((dn) => dn.snssai === snssai),
              ({ dnn }) => dnn,
            );
            return { ...NetDef.splitSNSSAI(snssai).ih, dnn };
          }),
        }],
        sbi: this.makeSBI(s),
        pfcp: {
          server: [makeSockNode(s, "n4")],
          client: {
            upf: Array.from(this.ctx.network.upfs, (upf): O5G.smf.PfcpUpf => ({
              address: compose.getIP(this.ctx.c, upf.name, "n4"),
              dnn: Array.from(
                this.ctx.netdef.listDataPathPeers(upf.name),
                ([peer]) => peer,
              ).filter((peer) => typeof peer === "string"),
            })),
          },
        },
        gtpu: { server: [makeSockNode(s, "n4")] },
        session: Array.from(
          this.ctx.network.dataNetworks.filter(({ type }) => type.startsWith("IP")),
          ({ subnet }) => ({ subnet: subnet! }),
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
      ...makeLaunchCommands(smf.name, cfg, { dels }),
    ]);
  }

  private defineService(ct: string, nets: readonly string[]): ComposeService {
    let s = this.ctx.c.services[ct];
    if (s) {
      s.image = o5DockerImage;
      for (const net of nets) {
        if (!s.networks[net]) {
          compose.connectNetif(this.ctx.c, ct, net, this.ctx.ipAlloc.allocNetif(net, ct));
        }
      }
    } else {
      s = this.ctx.defineService(ct, o5DockerImage, nets);
    }
    s.stop_signal = "SIGTERM";
    return s;
  }

  private makeSBI(s: ComposeService): PartialDeep<O5G.SBI> {
    const sbi: PartialDeep<O5G.SBI> = {
      server: [makeSockNode(s, "cp", 8080)],
    };
    if (s.container_name !== "nrf") {
      sbi.client = {
        scp: [],
        nrf: [{ uri: this.nrfUri! }],
      };
    }
    return sbi;
  }
}
