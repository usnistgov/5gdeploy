import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { PH } from "../types/mod.js";
import { assert, findByName } from "../util/mod.js";
import { PhoenixScenarioBuilder } from "./builder.js";
import { type PhoenixOpts, tasksetScript, USIM } from "./options.js";
/** Build RAN functions using Open5GCore RAN simulators. */
export async function phoenixRAN(ctx: NetDefComposeContext, opts: PhoenixOpts): Promise<void> {
  const b = new PhoenixRANBuilder(ctx, opts);
  await b.build();
}

class PhoenixRANBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "ran";

  public async build(): Promise<void> {
    await this.buildGNBs();
    await this.buildUEs();
    await this.finish();
  }

  private async buildGNBs(): Promise<void> {
    const sliceKeys = ["slice", "slice2"] as const;
    const slices = Array.from(netdef.listNssai(this.ctx.network), (snssai) => netdef.splitSNSSAI(snssai).ih);
    assert(slices.length <= sliceKeys.length, `gNB allows up to ${sliceKeys.length} slices`);
    const nWorkers = this.opts["phoenix-gnb-workers"];

    for (const gnb of netdef.listGnbs(this.ctx.network)) {
      const { s, nf, initCommands } = await this.defineService(gnb.name, ["air", "n2", "n3"], "5g/gnb1.json");
      s.sysctls["net.ipv4.ip_forward"] = 0;
      compose.annotate(s, "cpus", this.opts["phoenix-gnb-taskset"][1] + nWorkers);

      nf.editModule("gnb", ({ config }) => {
        Object.assign(config, this.plmn);
        delete config.amf_addr;
        delete config.amf_port;
        config.amf_list = Array.from(compose.listByNf(this.ctx.c, "amf"), (amf) => ({
          ngc_addr: compose.getIP(amf, "n2"),
          ngc_sctp_port: 38412,
        } as const));
        config.gnb_id = gnb.nci.gnb;
        config.cell_id = gnb.nci.nci;
        config.tac = Number.parseInt(this.ctx.network.tac, 16);

        for (const [i, k] of sliceKeys.entries()) {
          if (slices.length > i) {
            config[k] = slices[i];
          } else {
            delete config[k]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
          }
        }

        config.forwarding_worker = nWorkers;
      });

      initCommands.push(
        "iptables -I OUTPUT -p icmp --icmp-type destination-unreachable -j DROP",
        ...compose.applyQoS(s),
        ...tasksetScript(this.opts["phoenix-gnb-taskset"], nWorkers, "gnbUSockFwd"),
      );
    }
  }

  private async buildUEs(): Promise<void> {
    const { "phoenix-ue-isolated": isolated } = this.opts;
    const mcc = Number.parseInt(this.plmn.mcc, 10);
    const mnc = Number.parseInt(this.plmn.mnc, 10);

    for (const [ct, sub] of compose.suggestUENames(netdef.listSubscribers(this.ctx.network))) {
      const { s, nf } = await this.defineService(ct, ["air"], "5g/ue1.json");
      compose.annotate(s, "cpus", isolated.some((suffix) => sub.supi.endsWith(suffix)) ? 1 : 0);
      compose.annotate(s, "ue_supi", sub.supi);

      nf.editModule("ue_5g_nas_only", ({ config }) => {
        config.usim = {
          supi: sub.supi,
          k: sub.k,
          amf: USIM.amf,
          opc: sub.opc,
          start_sqn: USIM.sqn,
        };
        delete config["usim-test-vector19"];

        config.dn_list = sub.requestedDN.map(({ snssai, dnn }): PH.ue_5g_nas_only.DN => {
          const dn = netdef.findDN(this.ctx.network, dnn, snssai);
          assert(dn.type !== "IPv6");
          return {
            dnn: dn.dnn,
            dn_type: dn.type,
          };
        });
        config.DefaultNetwork.dnn = config.dn_list[0]?.dnn ?? "default";

        config.Cell = sub.gnbs.map((gnbName): PH.ue_5g_nas_only.Cell => {
          const gnb = findByName(gnbName, netdef.listGnbs(this.ctx.network));
          const gnbService = this.ctx.c.services[gnbName]!;
          assert(!!gnb);
          return {
            mcc,
            mnc,
            cell_id: gnb.nci.nci,
            gnb_cp_addr: compose.getIP(gnbService, "air"),
            gnb_up_addr: compose.getIP(gnbService, "air"),
            gnb_port: 10000,
          };
        });

        config.ip_tool = "/opt/phoenix/cfg/5g/ue-tunnel-mgmt.sh";
      });
    }
  }
}
