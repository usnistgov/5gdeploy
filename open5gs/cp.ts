import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import { oaiCP } from "../oai/cn5g.js";
import { oaiOptions } from "../oai/options.js";
import type { O5G } from "../types/mod.js";
import { YargsDefaults } from "../util/yargs.js";

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

  public async build(): Promise<void> {
    await oaiCP(this.ctx, YargsDefaults(oaiOptions));
    await this.buildNRF();
  }

  private async buildNRF(): Promise<void> {
    const s = this.ctx.c.services.nrf!;
    s.image = "5gdeploy.localhost/open5gs";
    s.stop_signal = "SIGTERM";

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
      "msg Preparing Open5GS NRF config",
      ...compose.mergeConfigFile(cfg, {
        base: "/opt/open5gs/etc/open5gs/nrf.yaml",
        merged: "/nrf.yaml",
      }),
      "msg Starting Open5GS NRF",
      "exec yasu open5gs open5gs-nrfd -c /nrf.yaml",
    ]);
  }
}
