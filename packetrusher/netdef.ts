import assert from "minimalistic-assert";
import * as shlex from "shlex";
import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import type * as N from "../types/netdef.js";
import type * as prush from "../types/packetrusher.js";

/** Define PacketRusher container. */
export async function buildRAN(ctx: NetDefComposeContext): Promise<void> {
  assert(ctx.network.gnbs.length === 1, "can only use 1 gNB");
  const gnb = ctx.network.gnbs[0]!;
  const subscribers = ctx.netdef.listSubscribers(false);
  assert(subscribers.length === 1, "can only use 1 UE");
  const sub = subscribers[0]!;

  const s = ctx.defineService(gnb.name, "5gdeploy.localhost/packetrusher", ["n2", "n3"]);
  s.privileged = true;
  s.devices.push("/dev/net/tun:/dev/net/tun");

  const c = makeConfigUpdate(ctx, gnb, sub);
  compose.setCommands(s, [
    "msg Preparing PacketRusher config",
    `echo ${shlex.quote(JSON.stringify(c))} >/config.update.yml`,
    "yq -P '. *= load(\"/config.update.yml\")' /config.default.yml | tee /config.yml",
    "sleep 10",
    "msg Starting PacketRusher",
    "exec /packetrusher --config /config.yml ue",
  ], "ash");
}

function makeConfigUpdate(ctx: NetDefComposeContext, gnb: N.GNB, sub: NetDef.Subscriber): PartialDeep<prush.Root> {
  const [mcc, mnc] = NetDef.splitPLMN(ctx.network.plmn);
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
