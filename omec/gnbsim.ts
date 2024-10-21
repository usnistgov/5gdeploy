import type { OptionalKeysOf, PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, OMEC } from "../types/mod.js";
import { assert, hexPad } from "../util/mod.js";

/** Build RAN functions using gNBSim. */
export async function gnbsimRAN(ctx: NetDefComposeContext): Promise<void> {
  for (const [ct, gnb] of compose.suggestNames("gnb", ctx.netdef.gnbs)) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/gnbsim", ["mgmt", "n2", "n3"]);
    s.stop_signal = "SIGQUIT";
    const c = makeConfigUpdate(ctx, s, gnb);
    await ctx.writeFile(`ran-cfg/${ct}.yaml`, c, { s, target: "/config.update.yaml" });
    compose.setCommands(s, [
      ...compose.renameNetifs(s, { disableTxOffload: true }),
      "msg Preparing gNBSim config",
      ...compose.mergeConfigFile("/config.update.yaml", {
        base: "/config.base.yaml",
        merged: "/gnbsim.yaml",
      }),
      "sleep 10",
      "msg Starting gNBSim",
      "exec /gnbsim --cfg /gnbsim.yaml",
    ], { shell: "ash" });
  }
}

function makeConfigUpdate(ctx: NetDefComposeContext, s: ComposeService, gnb: NetDef.GNB): PartialDeep<OMEC.Root<OMEC.gnbsim.Configuration>> {
  const plmnId: OMEC.PLMNID = NetDef.splitPLMN(ctx.network.plmn);
  const amfIP = ctx.gatherIPs("amf", "n2")[0]!;
  const g: OMEC.gnbsim.GNB = {
    n2IpAddr: compose.getIP(s, "n2"),
    n2Port: 9487,
    n3IpAddr: compose.getIP(s, "n3"),
    n3Port: 2152,
    name: gnb.name,
    globalRanId: {
      plmnId,
      gNbId: {
        bitLength: ctx.network.gnbIdLength,
        gNBValue: hexPad(gnb.nci.gnb, Math.ceil(ctx.network.gnbIdLength / 4)),
      },
    },
    supportedTaList: [{
      tac: ctx.network.tac,
      broadcastPlmnList: [{
        plmnId,
        taiSliceSupportList: ctx.netdef.nssai.map((snssai) => NetDef.splitSNSSAI(snssai).ih),
      }],
    }],
    defaultAmf: {
      hostName: amfIP,
      ipAddr: amfIP,
      port: 38412,
    },
  };

  const subs = ctx.netdef.listSubscribers({ expandCount: false, gnb: gnb.name });
  const profiles: OMEC.gnbsim.Profile[] = [];
  for (const profile of PROFILES) {
    for (const sub of subs) {
      profiles.push(makeProfile(ctx, gnb, sub, profile));
    }
  }

  return {
    configuration: {
      gnbs: { [gnb.name]: g },
      httpServer: { enable: true, ipAddr: compose.getIP(s, "mgmt") },
      profiles,
      execInParallel: true,
      runConfigProfilesAtStart: true,
    },
  };
}

type ProfileBase = Pick<OMEC.gnbsim.Profile, "profileType" | OptionalKeysOf<OMEC.gnbsim.Profile>>;

const PROFILES: readonly ProfileBase[] = [
  {
    profileType: "deregister",
    dataPktCount: 5,
  },
];

function makeProfile(ctx: NetDefComposeContext, gnb: NetDef.GNB, sub: NetDef.Subscriber, base: ProfileBase): OMEC.gnbsim.Profile {
  assert(sub.requestedDN.length > 0);
  const dn = ctx.netdef.findDN(sub.requestedDN[0]!);
  assert(!!dn);
  const dnIP = compose.getIP(ctx.c.services[`dn_${dn.dnn}`]!, "n6");
  const plmnId: OMEC.PLMNID = NetDef.splitPLMN(ctx.network.plmn);

  return {
    profileName: `${base.profileType}-${sub.supi}`,
    enable: true,
    gnbName: gnb.name,
    startImsi: sub.supi,
    ueCount: sub.count,
    defaultAs: dnIP,
    key: sub.k,
    opc: sub.opc,
    sequenceNumber: "000000000020",
    dnn: dn.dnn,
    sNssai: NetDef.splitSNSSAI(dn.snssai).ih,
    execInParallel: true,
    plmnId,
    ...base,
  };
}
