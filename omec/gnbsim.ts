import assert from "minimalistic-assert";
import type { OptionalKeysOf, PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { type N, NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import type { ComposeService } from "../types/compose.js";
import type * as OMEC from "../types/omec.js";

export async function gnbsimRAN(ctx: NetDefComposeContext): Promise<void> {
  for (const [ct, gnb] of compose.suggestNames("gnb", ctx.network.gnbs)) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/gnbsim", ["mgmt", "n2", "n3"]);
    s.cap_add.push("NET_ADMIN");
    const c = makeConfigUpdate(ctx, s, gnb);
    await ctx.writeFile(`ran-cfg/${ct}.yaml`, c, { s, target: "/config.update.yaml" });
    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      "msg Preparing gNBSim config",
      ...compose.mergeConfigFile("/config.update.yaml", {
        base: "/config.base.yaml",
        merged: "/gnbsim.yaml",
      }),
      "sleep 10",
      "msg Starting gNBSim",
      "exec /gnbsim --cfg /gnbsim.yaml",
    ], "ash");
  }
}

function makePLMNID(network: N.Network): OMEC.PLMNID {
  const [mcc, mnc] = NetDef.splitPLMN(network.plmn);
  return { mcc, mnc };
}

function makeConfigUpdate(ctx: NetDefComposeContext, s: ComposeService, gnb: N.GNB): PartialDeep<OMEC.Root<OMEC.gnbsim.Configuration>> {
  const plmnId = makePLMNID(ctx.network);
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
        taiSliceSupportList: ctx.netdef.nssai.map((snssai) => NetDef.splitSNSSAI(snssai).ih),
      }],
    }],
    defaultAmf: {
      hostName: amfIP,
      ipAddr: amfIP,
      port: 38412,
    },
  };

  const subs = ctx.netdef.listSubscribers(false).filter((sub) => sub.gnbs.includes(gnb.name));
  const profiles: OMEC.gnbsim.Profile[] = [];
  for (const profile of PROFILES) {
    for (const sub of subs) {
      profiles.push(makeProfile(ctx, gnb, sub, profile));
    }
  }

  return {
    configuration: {
      gnbs: { [gnb.name]: g },
      httpServer: { enable: true, ipAddr: s.networks.mgmt!.ipv4_address },
      profiles,
      runConfigProfilesAtStart: true,
    },
  };
}

type ProfileBase = Pick<OMEC.gnbsim.Profile, "profileType" | OptionalKeysOf<OMEC.gnbsim.Profile>>;

const PROFILES: readonly ProfileBase[] = [
  {
    // "deregister" = Registration + UE initiated PDU Session Establishment + User Data packets + Deregister
    profileType: "deregister",
    dataPktCount: 5,
  },
];

function makeProfile(ctx: NetDefComposeContext, gnb: N.GNB, sub: NetDef.Subscriber, base: ProfileBase): OMEC.gnbsim.Profile {
  assert(sub.requestedDN.length > 0);
  const dn = ctx.netdef.findDN(sub.requestedDN[0]!);
  assert(!!dn);
  const upfNames = Array.from(ctx.netdef.listDataPathPeers(dn), ([node]) => node)
    .filter((node): node is string => typeof node === "string");
  assert(upfNames.length > 0);
  const upfService = ctx.c.services[upfNames[0]!]!;
  const plmnId = makePLMNID(ctx.network);

  return {
    profileName: `${base.profileType}-${sub.supi}`,
    enable: true,
    gnbName: gnb.name,
    startImsi: sub.supi,
    ueCount: sub.count,
    defaultAs: upfService.networks.n6!.ipv4_address,
    key: sub.k,
    opc: sub.opc,
    sequenceNumber: "000000000020",
    dnn: dn.dnn,
    sNssai: NetDef.splitSNSSAI(dn.snssai).ih,
    execInParallel: false,
    plmnId,
    ...base,
  };
}
