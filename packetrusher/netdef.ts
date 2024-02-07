import assert from "minimalistic-assert";
import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { prush } from "../types/mod.js";
import { hexPad } from "../util/mod.js";

/** Build RAN functions using PacketRusher. */
export async function packetrusherRAN(ctx: NetDefComposeContext): Promise<void> {
  assert(ctx.network.gnbIdLength === 24, "only support 24-bit gNB ID");
  const gnbs = new Map<string, NetDef.GNB>(ctx.netdef.gnbs.map((gnb) => [gnb.name, gnb]));
  for (const sub of ctx.netdef.listSubscribers()) {
    assert(sub.gnbs.length === 1, "each UE can only connect to 1 gNB");
    const gnb = gnbs.get(sub.gnbs[0]!);
    gnbs.delete(sub.gnbs[0]!);
    assert(gnb !== undefined, "each gNB can only serve 1 UE");

    defineGnbUe(ctx, gnb, sub);
  }
}

function defineGnbUe(ctx: NetDefComposeContext, gnb: NetDef.GNB, sub: NetDef.Subscriber): void {
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

function makeConfigUpdate(ctx: NetDefComposeContext, gnb: NetDef.GNB, sub: NetDef.Subscriber): PartialDeep<prush.Root> {
  const plmn = NetDef.splitPLMN(ctx.network.plmn);
  const s = ctx.c.services[gnb.name]!;

  const c: PartialDeep<prush.Root> = {};
  c.amfif = {
    ip: ctx.gatherIPs("amf", "n2")[0]!,
  };
  c.gnodeb = {
    controlif: { ip: s.networks.n2!.ipv4_address },
    dataif: { ip: s.networks.n3!.ipv4_address },
    plmnlist: {
      ...plmn,
      tac: hexPad(ctx.netdef.tac, 6),
      gnbid: hexPad(gnb.nci.gnb, 6),
    },
  };

  c.ue = {
    msin: sub.supi.slice(-10),
    key: sub.k,
    opc: sub.opc,
    hplmn: plmn,
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
