import stringify from "json-stringify-deterministic";
import { Netmask } from "netmask";
import { map } from "obliterator";
import * as shlex from "shlex";

import { compose, makeUPFRoutes, type netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { assert, YargsGroup, type YargsInfer } from "../util/mod.js";

const ndndpdkDockerImage = "localhost/ndn-dpdk";

export const ndndpdkOptions = YargsGroup("NDN-DPDK options:", {
  "ndndpdk-gtpip": {
    default: true,
    desc: "enable GTP-IP handler",
    type: "boolean",
  },
  "ndndpdk-activate": {
    desc: "activate NDN-DPDK forwarder with JSON parameters",
    type: "string",
  },
  "ndndpdk-create-eth-port": {
    desc: "ndndpdk-ctrl create-eth-port command line",
    type: "string",
  },
});
type NdndpdkOpts = YargsInfer<typeof ndndpdkOptions>;

/** Build NDN-DPDK UPF. */
export function ndndpdkUP(ctx: NetDefComposeContext, upf: netdef.UPF, opts: NdndpdkOpts): void {
  const { name: ct, nets, peers } = upf;
  const {
    "ndndpdk-gtpip": gtpip,
    "ndndpdk-activate": activate,
  } = opts;
  assert(peers.N6IPv4.length === 1, `UPF ${ct} must handle exactly 1 IPv4 DN`);

  let gtpNet: "n3" | "n9";
  if (nets.includes("n3")) {
    assert(!nets.includes("n9"), `UPF ${ct} cannot have both N3 or N9`);
    gtpNet = "n3";
  } else {
    assert(nets.includes("n9"), `UPF ${ct} must have either N3 or N9`);
    gtpNet = "n9";
  }
  const gtpCidr = new Netmask(ctx.c.networks[gtpNet]!.ipam.config[0]!.subnet).bitmask;

  const s = ctx.defineService(ct, ndndpdkDockerImage, ["mgmt", ...nets]);
  if (gtpip) {
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
  }
  let svc: ComposeService | undefined;
  if (activate) {
    svc = ctx.defineService(ct.replace(/^upf/, "upfsvc"), ndndpdkDockerImage, []);
    svc.network_mode = `service:${ct}`;
    svc.privileged = true;
    svc.volumes.push({
      type: "bind",
      source: "/run/ndn",
      target: "/run/ndn",
      bind: { create_host_path: true },
    });
  }

  ctx.finalize.push(() => setCommands(ctx, s, upf, opts, gtpNet, gtpCidr));
}

function setCommands(
    ctx: NetDefComposeContext,
    s: ComposeService,
    { peers }: netdef.UPF,
    {
      "ndndpdk-gtpip": gtpip,
      "ndndpdk-activate": activate,
      "ndndpdk-create-eth-port": createEthPort,
    }: NdndpdkOpts,
    gtpNet: "n3" | "n9",
    gtpCidr: number,
): void {
  const { c } = ctx;
  const [upfN4ip] = compose.getIPMAC(s, "n4");
  const flags = [
    `--smf-n4=${compose.getIP(c, "smf*", "n4")}`,
    `--upf-n4=${upfN4ip}`,
    `--dn=${compose.getIP(c, `dn_${peers.N6IPv4[0]!.dnn}`, "n6")}`,
  ];

  const [gtpIP, gtpMAC] = compose.getIPMAC(s, gtpNet);
  flags.push(
    `--upf-n3=${gtpIP}`,
    `--upf-mac=${gtpMAC}`,
  );
  for (const { name } of peers[gtpNet.toUpperCase() as Uppercase<typeof gtpNet>]) {
    const [peerIP, peerMAC] = compose.getIPMAC(c, name, gtpNet);
    flags.push(`--n3=${peerIP}=${peerMAC}`);
  }

  const passthruLocatorBase: any = {
    scheme: "passthru",
  };
  if (gtpip) {
    passthruLocatorBase.gtpip = {};
  }

  compose.setCommands(s, (function*() {
    yield* compose.renameNetifs(s);

    yield `msg Flushing IP addresses on ${gtpNet} netif`;
    yield `ip -4 addr flush ${gtpNet} || true`; // skip if netif does not exist, e.g. vfio-pci

    if (activate) {
      yield "msg Activating NDN-DPDK service";
      yield `echo ${shlex.quote(activate)} | ndndpdk-ctrl activate-forwarder`;
      yield "msg Creating NDN-DPDK ethdev";
      yield `ndndpdk-ctrl create-eth-port ${createEthPort}`;
    } else {
      yield "msg Waiting for NDN-DPDK ethdev";
      yield `wait_ethdev() { test $(ndndpdk-ctrl list-ethdev 2>/dev/null | jq -s --arg MAC ${
        gtpMAC} 'map(select(.macAddr==$MAC)) | length') -gt 0; }`;
      yield "with_retry wait_ethdev"; // `with_retry $(subshell)` is incorrect - subshell is evaluated only once
    }

    yield "msg Listing NDN-DPDK ethdevs";
    yield "ndndpdk-ctrl list-ethdev | tee ethdev.ndjson";

    yield `if [[ $(ip -o addr show to ${gtpIP} | wc -l) -ne 0 ]]; then`;
    yield `  msg Found ${gtpIP} on a netif, cannot create passthru face`;
    yield "else";
    yield `  ETHDEV_ID=$(jq -r --arg MAC ${gtpMAC} 'select(.macAddr==$MAC) | .id' ethdev.ndjson | head -1)`;
    yield "  msg Making NDN-DPDK passthru face on $ETHDEV_ID";
    yield `  echo ${shlex.quote(stringify(passthruLocatorBase))} | jq --arg MAC ${
      gtpMAC} --arg PORT $ETHDEV_ID '. * {local:$MAC,port:$PORT}' | ndndpdk-ctrl create-face`;
    yield `  PASSTHRU_NETIF=$(ip -j link show | jq -r --arg MAC ${gtpMAC} '.[] | select(.address==$MAC and (.ifname|startswith("ndndpdkPT"))) | .ifname')`;
    yield `  ip addr add ${gtpIP}/${gtpCidr} dev $PASSTHRU_NETIF`;
    yield "  msg Listing passthru device";
    yield "  ip addr show dev $PASSTHRU_NETIF";
    if (gtpip) {
      yield* map(makeUPFRoutes(ctx, peers, { upfNetif: "$PASSTHRU_NETIF", upfNetifNeigh: true }), (line) => `  ${line}`);
    }
    yield "fi";

    yield "msg Starting UPF";
    yield `ndndpdk-upf ${shlex.join(flags)}`;
  })());
}
