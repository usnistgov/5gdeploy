import assert from "minimalistic-assert";
import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { type N, NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import type * as prush from "../types/packetrusher.js";

/** Define PacketRusher containers. */
export async function packetrusherRAN(ctx: NetDefComposeContext): Promise<void> {
  assert(ctx.network.gnbIdLength === 24, "only support 24-bit gNB ID");
  const gnbs = new Map<string, N.GNB>(ctx.network.gnbs.map((gnb) => [gnb.name, gnb]));
  for (const sub of ctx.netdef.listSubscribers(true)) {
    assert(sub.gnbs.length === 1, "each UE can only connect to 1 gNB");
    const gnb = gnbs.get(sub.gnbs[0]!);
    gnbs.delete(sub.gnbs[0]!);
    assert(gnb !== undefined, "each gNB can only serve 1 UE");

    defineGnbUe(ctx, gnb, sub);
  }
}

function defineGnbUe(ctx: NetDefComposeContext, gnb: N.GNB, sub: NetDef.Subscriber): void {
  const s = ctx.defineService(gnb.name, "5gdeploy.localhost/packetrusher", ["n2", "n3"]);
  s.cap_add.push("NET_ADMIN");
  s.devices.push("/dev/net/tun:/dev/net/tun");
  compose.annotate(s, "cpus", 1);

  const c = makeConfigUpdate(ctx, gnb, sub);
  const filename = `/config.${gnb.name}.${sub.supi}.yml`;
  compose.setCommands(s, [
    "msg Preparing PacketRusher config",
    ...compose.mergeConfigFile(c, { base: "/config.default.yml", merged: filename }),
    "sleep 10",
    "msg Starting PacketRusher",
    `exec /packetrusher --config ${filename} multi-ue -n 1 -d -t --tunnel-vrf=false`,
  ], "ash");
}

function makeConfigUpdate(ctx: NetDefComposeContext, gnb: N.GNB, sub: NetDef.Subscriber): PartialDeep<prush.Root> {
  const [mcc, mnc] = NetDef.splitPLMN(ctx.network.plmn);
  const nci = ctx.netdef.splitNCI(gnb.nci);
  const s = ctx.c.services[gnb.name]!;

  const c: PartialDeep<prush.Root> = {};
  c.amfif = {
    ip: ctx.gatherIPs("amf", "n2").slice(0, 1)[0]!,
  };
  c.gnodeb = {
    controlif: { ip: s.networks.n2!.ipv4_address },
    dataif: { ip: s.networks.n3!.ipv4_address },
    plmnlist: {
      mcc,
      mnc,
      tac: ctx.netdef.tac.toString(16).padStart(6, "0"),
      gnbid: nci.gnb.toString(16).padStart(6, "0"),
    },
  };

  c.ue = {
    msin: sub.supi.slice(-10),
    key: sub.k,
    opc: sub.opc,
    hplmn: { mcc, mnc },
  };

  if (sub.requestedDN.length > 0) {
    const dn = sub.requestedDN[0]!;
    const snssai = NetDef.splitSNSSAI(dn.snssai);
    c.gnodeb.slicesupportlist = {
      sst: snssai.hex.sst,
      sd: snssai.hex.sd ?? "",
    };
    c.ue.snssai = {
      sst: snssai.int.sst,
      sd: snssai.hex.sd ?? "",
    };
    c.ue.dnn = dn.dnn;
  }

  return c;
}
