import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import { oaiCP } from "../oai/cn5g.js";
import { oaiOptions } from "../oai/options.js";
import type { ComposeService, N, O5G } from "../types/mod.js";
import { assert } from "../util/mod.js";
import { YargsDefaults } from "../util/yargs.js";
import { configureMetrics, makeLaunchCommands, o5DockerImage } from "./common.js";

/** Build CP functions using Open5GS. */
export async function o5CP(ctx: NetDefComposeContext): Promise<void> {
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
    await oaiCP(this.ctx, YargsDefaults(oaiOptions));
    await this.buildNRF();
    for (const smf of this.ctx.netdef.smfs) {
      await this.buildSMF(smf);
    }
  }

  private async buildNRF(): Promise<void> {
    const s = this.defineService("nrf", ["cp"]);
    const cfg: PartialDeep<O5G.nrf.Root> = {
      nrf: {
        sbi: {
          server: [{
            address: compose.getIP(s, "cp"),
            port: 8080,
          }],
        },
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

  private async buildSMF(smf: Required<N.SMF>): Promise<void> {
    const s = this.defineService(smf.name, ["mgmt", "cp", "n4"]);
    const cfg: PartialDeep<O5G.smf.Root> = {
      smf: {
        sbi: {
          server: [{
            address: compose.getIP(s, "cp"),
            port: 8080,
          }],
          client: {
            scp: [],
            nrf: [{ uri: this.nrfUri! }],
          },
        },
        pfcp: {
          server: [{ dev: "n4" }],
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
        gtpc: {
          server: [{ dev: "n4" }],
        },
        gtpu: {
          server: [{ dev: "n4" }],
        },
        metrics: configureMetrics(s),
      },
    };
    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...makeLaunchCommands(smf.name, cfg, { dels: [".smf.freeDiameter"] }),
    ]);
  }

  private defineService(ct: string, nets: readonly string[]): ComposeService {
    const s = this.ctx.c.services[ct];
    assert(s);
    s.image = o5DockerImage;
    s.stop_signal = "SIGTERM";
    for (const net of nets) {
      if (!s.networks[net]) {
        compose.connectNetif(this.ctx.c, ct, net, this.ctx.ipAlloc.allocNetif(net, ct));
      }
    }
    return s;
  }
}
