import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { N, PH } from "../types/mod.js";
import { assert } from "../util/mod.js";
import { PhoenixScenarioBuilder } from "./builder.js";
import { type PhoenixOpts, tasksetScript, USIM } from "./options.js";

/** Build RAN functions using Open5GCore RAN simulators. */
export async function phoenixRAN(ctx: NetDefComposeContext, opts: PhoenixOpts): Promise<void> {
  const b = new PhoenixRANBuilder(ctx, opts);
  await b.build();
}

class PhoenixRANBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "ran";
  private readonly gnbs = new Map<string, [nci: number, airIP: string]>();
  private tac!: number;
  private plmnInt!: Pick<PH.ue_5g_nas_only.Cell, keyof PH.PLMNID>;

  public async build(): Promise<void> {
    this.tac = Number.parseInt(this.ctx.network.tac, 16);
    const { mcc, mnc } = netdef.splitPLMN(this.ctx.network.plmn, true);
    this.plmnInt = { mcc, mnc };

    for (const gnb of netdef.listGnbs(this.ctx.network)) {
      const airIP = await this.buildGNB(gnb);
      this.gnbs.set(gnb.name, [gnb.nci.nci, airIP]);
    }
    for (const [ct, sub] of compose.suggestUENames(netdef.listSubscribers(this.ctx.network))) {
      await this.buildUE(ct, sub);
    }
    await this.finish();
  }

  private async buildGNB(gnb: netdef.GNB): Promise<string> {
    const nWorkers = this.opts["phoenix-gnb-workers"];
    const sliceKeys = ["slice", "slice2"] as const;
    const slices = new Set<N.SNSSAI>();
    for (const sub of netdef.listSubscribers(this.ctx.network, { gnb: gnb.name })) {
      for (const { snssai } of sub.subscribedNSSAI) {
        slices.add(snssai);
      }
    }
    assert(slices.size <= sliceKeys.length, `gNB allows up to ${sliceKeys.length} slices`);
    const sliceValues = Array.from(slices, (snssai) => netdef.splitSNSSAI(snssai).ih);

    const { s, nf, initCommands } = await this.defineService(gnb.name, ["air", "n2", "n3"], "5g/gnb1.json");

    nf.editModule("gnb", ({ config }) => {
      Object.assign(config, this.plmn);
      delete config.amf_addr;
      delete config.amf_port;
      config.amf_list = Array.from(
        compose.listByNf(this.ctx.c, "amf"),
        (amf) => ({ ngc_addr: compose.getIP(amf, "n2"), ngc_sctp_port: 38412 }),
      );
      config.gnb_id = gnb.nci.gnb;
      config.cell_id = gnb.nci.nci;
      config.tac = this.tac;
      for (const [i, k] of sliceKeys.entries()) {
        config[k] = sliceValues[i];
      }

      config.forwarding_worker = nWorkers;
    });

    initCommands.push(
      "iptables -I OUTPUT -p icmp --icmp-type destination-unreachable -j DROP",
      ...compose.applyQoS(s),
      ...tasksetScript(s, this.opts["phoenix-gnb-taskset"], nWorkers, "gnbUSockFwd"),
    );

    return compose.getIP(s, "air");
  }

  private async buildUE(ct: string, sub: netdef.Subscriber): Promise<void> {
    const isolated = this.opts["phoenix-ue-isolated"].some((suffix) => sub.supi.endsWith(suffix));

    const { s, nf } = await this.defineService(ct, ["air"], "5g/ue1.json");
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
    compose.annotate(s, "cpus", Number(isolated));
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
        const gnbInfo = this.gnbs.get(gnbName);
        assert(!!gnbInfo);
        const [cell_id, airIP] = gnbInfo;
        return {
          ...this.plmnInt,
          cell_id,
          gnb_cp_addr: airIP,
          gnb_up_addr: airIP,
          gnb_port: 10000,
        };
      });

      config.ip_tool = "/opt/phoenix/cfg/5g/ue-tunnel-mgmt.sh";
    });
  }
}
