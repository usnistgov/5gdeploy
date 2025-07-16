import { ip2long, long2ip } from "netmask";
import * as shlex from "shlex";
import type { PartialDeep } from "type-fest";

import { dependOnGtp5g, type F5Opts } from "../free5gc/mod.js";
import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, prush } from "../types/mod.js";
import { assert, decPad, hexPad, YargsGroup, type YargsInfer, YargsIntRange } from "../util/mod.js";

/** Yargs options definition for PacketRusher. */
export const prushOptions = YargsGroup("PacketRusher options:", {
  "prush-log": YargsIntRange({
    default: 4,
    desc: "log level (higher number is more verbose)",
    min: 1,
    max: 6,
  }),
  "prush-tunnel": {
    default: true,
    desc: "enable GTP-U tunnel",
    type: "boolean",
  },
  "prush-multi": {
    default: false,
    desc: "put all gNBs in the same container",
    type: "boolean",
  },
  "prush-extra": {
    desc: "extra flags passed to PacketRusher",
    type: "string",
  },
});
export type PRushOpts = YargsInfer<typeof prushOptions>;

export const prushDockerImage = "5gdeploy.localhost/packetrusher";

/** Build RAN functions using PacketRusher. */
export async function prushRAN(
    ctx: NetDefComposeContext,
    opts: PRushOpts & F5Opts & netdef.SubscriberSingleDnOpt,
): Promise<void> {
  const pairs = parseOpts(ctx, opts);

  for (const [gnb, sub] of pairs) {
    const s = defineGnbUe(ctx, gnb, sub, opts, pairs.length);
    if (opts["prush-multi"]) {
      compose.annotate(s, "ue_supi", Array.from(pairs, ([, sub]) => sub.supi).join(","));
      break;
    }
  }
}

function parseOpts(
    { network }: NetDefComposeContext,
    {
      "ue-single-dn": singleDn,
      "prush-tunnel": tunnel,
      "prush-multi": multi,
    }: PRushOpts & netdef.SubscriberSingleDnOpt,
) {
  const pairs = Array.from(netdef.pairGnbUe(network, { allowMultiUE: !tunnel && !multi, singleDn }));
  assert(network.gnbIdLength === 24, "only support 24-bit gNB ID");
  assert(pairs.length > 0, "no gNB and UE defined");

  if (multi) {
    const [firstGnb, firstSub] = pairs[0]!;
    const firstSUPI = BigInt(firstSub.supi);
    for (const [i, [gnb, sub]] of pairs.entries()) {
      assert(gnb.nci.gnb === firstGnb.nci.gnb + i);
      assert(BigInt(sub.supi) === firstSUPI + BigInt(i));
      assert(sub.k === firstSub.k);
      assert(sub.opc === firstSub.opc);
    }
  }

  return pairs;
}

function defineGnbUe(
    ctx: NetDefComposeContext,
    gnb: netdef.GNB,
    sub: netdef.Subscriber,
    {
      "prush-log": logLevel,
      "prush-tunnel": tunnel,
      "prush-multi": multi,
      "prush-extra": extra,
      ...f5Opts
    }: PRushOpts & F5Opts,
    nGnbs: number,
): ComposeService {
  let nUes = sub.count;
  if (multi) {
    nUes = nGnbs;
    nGnbs = Math.max(2, nGnbs);
    ctx.ipAlloc.allocNetif("n2", gnb.name, nGnbs);
  } else {
    nGnbs = 1;
  }

  const s = ctx.defineService(gnb.name, prushDockerImage, ["mgmt", "n2", "n3"]);
  s.stop_signal = "SIGINT";
  compose.annotate(s, "cpus", 1);
  compose.annotate(s, "ue_supi", sub.supis.join(","));
  if (tunnel) {
    s.devices.push("/dev/net/tun:/dev/net/tun");
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
    dependOnGtp5g(s, ctx.c, f5Opts);
  }

  const [c, post] = makeConfigUpdate(ctx, s, logLevel, gnb, sub, nGnbs, nUes);

  const filename = `/config.${gnb.name}.${sub.supi}.yml`;
  const flags = [`--config=${filename}`, "multi-ue", `-n=${nUes}`];
  if (tunnel || multi) {
    flags.push("-d");
  }
  if (tunnel) {
    flags.push("-t", "--tunnel-vrf=false");
  }
  if (extra) {
    flags.push(...shlex.split(extra));
  }

  compose.setCommands(s, [
    ...compose.waitNetifs(s, { disableTxOffload: true, ipCount: { n2: nGnbs, n3: nGnbs } }),
    ...compose.applyQoS(s, "ash"),
    "msg Preparing PacketRusher config",
    ...compose.mergeConfigFile(c, { base: "/config.yml", post, merged: filename }),
    "sleep 20",
    `msg Starting PacketRusher with tunnel=${Number(tunnel)} multi=${Number(multi)}`,
    `exec /packetrusher ${shlex.join(flags)}`,
  ], { shell: "ash" });

  return s;
}

function makeConfigUpdate(
    ctx: NetDefComposeContext, s: ComposeService, logLevel: number,
    gnb: netdef.GNB, sub: netdef.Subscriber,
    nGnbs: number, nUes: number,
): [c: PartialDeep<prush.Root>, post: string[]] {
  const post: string[] = [];
  const plmn = netdef.splitPLMN(ctx.network.plmn);

  const c: PartialDeep<prush.Root> = {};
  c.logs = {
    level: logLevel as 1 | 2 | 3 | 4 | 5 | 6,
  };
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
  if (nGnbs > 1) {
    post.push(
      `.gnodeb.controlif.ip line_comment="upto ${long2ip(ip2long(c.gnodeb.controlif!.ip!) + nGnbs - 1)}"`,
      `.gnodeb.dataif.ip line_comment="upto ${long2ip(ip2long(c.gnodeb.dataif!.ip!) + nGnbs - 1)}"`,
    );
  }

  c.ue = {
    msin: prushSupiToMsin(sub.supi),
    key: sub.k,
    opc: sub.opc,
    hplmn: plmn,
  };
  if (nUes > 1) {
    post.push(`.ue.msin line_comment="upto ${decPad(BigInt(c.ue.msin!) + BigInt(nUes - 1), c.ue.msin!.length)}"`);
  }

  if (sub.requestedDN.length > 0) {
    const dn = sub.requestedDN[0]!;
    const snssai = netdef.splitSNSSAI(dn.snssai);
    c.gnodeb.slicesupportlist = { sd: "", ...snssai.hex };
    c.ue.snssai = { sd: "", ...snssai.ih };
    c.ue.dnn = dn.dnn;
  }

  return [c, post];
}

/** Determine MSIN from SUPI. */
export function prushSupiToMsin(supi: string): string {
  return supi.slice(-10);
}
