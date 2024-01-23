import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { type N, NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import type { ComposeService } from "../types/compose.js";
import type * as OMEC from "../types/omec.js";

export async function gnbsimRAN(ctx: NetDefComposeContext): Promise<void> {
  for (const [ct, gnb] of compose.suggestNames("gnb", ctx.network.gnbs)) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/gnbsim", ["n2", "n3"]);
    const c = makeConfigUpdate(ctx, s, gnb);
    await ctx.writeFile(`ran-cfg/${ct}.yaml`, c, { s, target: "/gnbsim/gnbsim.update.yaml" });
    compose.setCommands(s, [
      "msg Preparing gNBSim config",
      ...compose.mergeConfigFile("/gnbsim/gnbsim.update.yaml", {
        base: "/gnbsim/gnbsim.default.yaml",
        merged: "/gnbsim/gnbsim.yaml",
      }),
      "sleep 10",
      "msg Starting gNBSim",
      "exec ./gnbsim --cfg /gnbsim/gnbsim.yaml",
    ], "ash");
  }
}

function makeConfigUpdate(ctx: NetDefComposeContext, s: ComposeService, gnb: N.GNB): PartialDeep<OMEC.Root<OMEC.gnbsim.Configuration>> {
  const [mcc, mnc] = NetDef.splitPLMN(ctx.network.plmn);
  const plmnId: OMEC.PLMNID = { mcc, mnc };
  const nci = ctx.netdef.splitNCI(gnb.nci);
  const amfIP = ctx.gatherIPs("amf", "n2")[0]!;
  const g: OMEC.gnbsim.GNB = {
    n2IpAddr: s.networks.n2!.ipv4_address,
    n2Port: 9487,
    n3IpAddr: s.networks.n3!.ipv4_address,
    n3Port: 2152,
    name: gnb.name,
    globalRanId: {
      plmnId,
      gNbId: {
        bitLength: ctx.network.gnbIdLength,
        gNBValue: nci.gnb.toString(16).padStart(Math.ceil(ctx.network.gnbIdLength / 4), "0"),
      },
    },
    supportedTaList: [{
      tac: ctx.network.tac,
      broadcastPlmnList: [{
        plmnId,
        taiSliceSupportedList: ctx.netdef.nssai.map((snssai) => NetDef.splitSNSSAI(snssai).int),
      }],
    }],
    defaultAmf: {
      hostName: amfIP,
      ipAddr: amfIP,
      port: 38412,
    },
  };
  return {
    configuration: {
      gnbs: { [gnb.name]: g },
    },
  };
}
