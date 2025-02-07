import * as shlex from "shlex";
import type { PartialDeep } from "type-fest";

import { dependOnGtp5g, type F5Opts } from "../free5gc/mod.js";
import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, prush } from "../types/mod.js";
import { assert, hexPad } from "../util/mod.js";

/** Build RAN functions using PacketRusher. */
export async function packetrusherRAN(
    ctx: NetDefComposeContext,
    opts: F5Opts & netdef.SubscriberSingleDnOpt,
): Promise<void> {
  assert(ctx.network.gnbIdLength === 24, "only support 24-bit gNB ID");
  for (const [gnb, sub] of netdef.pairGnbUe(ctx.network, {
    allowMultiUE: true,
    singleDn: opts["ue-single-dn"],
  })) {
    defineGnbUe(ctx, gnb, sub, opts);
  }
}

function defineGnbUe(ctx: NetDefComposeContext, gnb: netdef.GNB, sub: netdef.Subscriber, opts: F5Opts): void {
  const s = ctx.defineService(gnb.name, "5gdeploy.localhost/packetrusher", ["mgmt", "n2", "n3"]);
  s.stop_signal = "SIGINT";
  compose.annotate(s, "cpus", 1);
  compose.annotate(s, "ue_supi", sub.supis.join(","));
  if (sub.count === 1) {
    s.devices.push("/dev/net/tun:/dev/net/tun");
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
    dependOnGtp5g(s, ctx.c, opts);
  }

  const c = makeConfigUpdate(ctx, s, gnb, sub);
  const filename = `/config.${gnb.name}.${sub.supi}.yml`;
  const flags = [
    `--config=${filename}`,
    "multi-ue",
    `-n=${sub.count}`,
  ];
  if (sub.count === 1) {
    flags.push("-d", "-t", "--tunnel-vrf=false");
  }
  compose.setCommands(s, [
    ...compose.renameNetifs(s, { disableTxOffload: true }),
    ...compose.applyQoS(s, "ash"),
    "msg Preparing PacketRusher config",
    ...compose.mergeConfigFile(c, { base: "/config.base.yml", merged: filename }),
    "sleep 20",
    `msg Starting PacketRusher ${sub.count === 1 ? "with 1 UE, tunnel enabled" : `with ${sub.count} UEs, tunnel disabled`}`,
    `exec /packetrusher ${shlex.join(flags)}`,
  ], { shell: "ash" });
}

function makeConfigUpdate(
    ctx: NetDefComposeContext, s: ComposeService,
    gnb: netdef.GNB, sub: netdef.Subscriber,
): PartialDeep<prush.Root> {
  const plmn = netdef.splitPLMN(ctx.network.plmn);

  const c: PartialDeep<prush.Root> = {};
  c.amfif = Array.from(
    compose.listByNf(ctx.c, "amf"),
    (amf) => ({ ip: compose.getIP(amf, "n2"), port: 38412 }),
  );
  c.gnodeb = {
    controlif: { ip: compose.getIP(s, "n2") },
    dataif: { ip: compose.getIP(s, "n3") },
    plmnlist: {
      ...plmn,
      tac: ctx.network.tac,
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
    const snssai = netdef.splitSNSSAI(dn.snssai);
    c.gnodeb.slicesupportlist = { sd: "", ...snssai.hex };
    c.ue.snssai = { sd: "", ...snssai.ih };
    c.ue.dnn = dn.dnn;
  }

  return c;
}
