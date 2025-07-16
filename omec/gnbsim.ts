import type { OptionalKeysOf, PartialDeep } from "type-fest";

import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, OMEC } from "../types/mod.js";
import { assert, hexPad } from "../util/mod.js";

/** Build RAN functions using gNBSim. */
export async function gnbsimRAN(
    ctx: NetDefComposeContext,
    opts: netdef.SubscriberSingleDnOpt,
): Promise<void> {
  for (const gnb of netdef.listGnbs(ctx.network)) {
    const s = ctx.defineService(gnb.name, "5gdeploy.localhost/gnbsim", ["mgmt", "n2", "n3"]);
    s.stop_signal = "SIGQUIT"; // SIGQUIT - immediate stop with panic; SIGTERM - 5-second delayed stop
    const c = makeConfigUpdate(ctx, opts, s, gnb);
    await ctx.writeFile(`ran-cfg/${gnb.name}.yaml`, c, { s, target: "/config.update.yaml" });
    compose.setCommands(s, [
      ...compose.waitNetifs(s, { disableTxOffload: true }),
      "msg Preparing gNBSim config",
      ...compose.mergeConfigFile("/config.update.yaml", {
        base: "/config.base.yaml",
        dels: [".configuration.gnbs", ".configuration.customProfiles"],
        merged: "/gnbsim.yaml",
      }),
      "sleep 15",
      "msg Starting gNBSim",
      "exec /gnbsim --cfg /gnbsim.yaml",
    ], { shell: "ash" });
  }
}

function makeConfigUpdate(
    ctx: NetDefComposeContext,
    opts: netdef.SubscriberSingleDnOpt,
    s: ComposeService,
    gnb: netdef.GNB,
): PartialDeep<OMEC.Root<OMEC.gnbsim.Configuration>> {
  const plmnId: OMEC.PLMNID = netdef.splitPLMN(ctx.network.plmn);
  const amfIP = compose.getIP(ctx.c, "amf*", "n2");
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
        taiSliceSupportList: Array.from(
          netdef.listNssai(ctx.network),
          (snssai) => netdef.splitSNSSAI(snssai, true).ih,
        ),
      }],
    }],
    defaultAmf: {
      hostName: amfIP,
      ipAddr: amfIP,
      port: 38412,
    },
  };

  const subs = netdef.listSubscribers(
    ctx.network,
    { expandCount: false, gnb: gnb.name, singleDn: opts["ue-single-dn"] },
  );
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

function makeProfile(
    ctx: NetDefComposeContext,
    gnb: netdef.GNB,
    sub: netdef.Subscriber,
    base: ProfileBase,
): OMEC.gnbsim.Profile {
  assert(sub.requestedDN.length > 0);
  const { dnn, snssai } = netdef.findDN(ctx.network, sub.requestedDN[0]!);
  const dnIP = compose.getIP(ctx.c, `dn_${dnn}`, "n6");
  const plmnId: OMEC.PLMNID = netdef.splitPLMN(ctx.network.plmn);

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
    dnn,
    sNssai: netdef.splitSNSSAI(snssai, true).ih,
    execInParallel: true,
    plmnId,
    ...base,
  };
}
