
import * as compose from "../compose/mod.js";
import type { NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, N } from "../types/mod.js";
import { assert } from "../util/mod.js";

const ndndpdkDockerImage = "localhost/ndn-dpdk";

/** Build NDN-DPDK UPF. */
export function ndndpdkUP(ctx: NetDefComposeContext, upf: N.UPF): void {
  const s = ctx.defineService(upf.name, ndndpdkDockerImage, ["mgmt", "n4", "n3", "n6"]);
  ctx.finalize.push(() => setCommands(ctx, s, upf));
}

function setCommands(ctx: NetDefComposeContext, s: ComposeService, upf: N.UPF): void {
  const [upfN4ip] = compose.getIPMAC(s, "n4");
  const [upfN3ip, upfN3mac] = compose.getIPMAC(s, "n3");
  const flags = [
    `--smf-n4=${ctx.gatherIPs("smf", "n4")[0]}`,
    `--upf-n4=${upfN4ip}`,
    `--upf-n3=${upfN3ip}`,
    `--upf-mac=${upfN3mac}`,
  ];

  const peers = ctx.netdef.gatherUPFPeers(upf);
  assert(peers.N6IPv4.length === 1);
  flags.push(`--dn=${ctx.gatherIPs([`dn_${peers.N6IPv4[0]!.dnn}`], "n6")}`);
  for (const gnb of peers.N3) {
    const [gnbN3ip, gnbN3mac] = compose.getIPMAC(ctx.c.services[gnb.name]!, "n3");
    flags.push(`--n3=${gnbN3ip}=${gnbN3mac}`);
  }

  compose.setCommands(s, [
    ...compose.renameNetifs(s),
    "msg Waiting for NDN-DPDK ethdev",
    `wait_ethdev() { test $(ndndpdk-ctrl list-ethdev 2>/dev/null | jq -s -e --arg MAC ${upfN3mac} "map(select(.macAddr==\\$MAC)) | length") -gt 0; }`,
    "with_retry wait_ethdev", // `with_retry $(subshell)` is incorrect - subshell is evaluated only once
    "msg Listing NDN-DPDK ethdevs",
    "ndndpdk-ctrl list-ethdev",
    "msg Starting UPF",
    `ndndpdk-upf ${flags.join(" ")}`,
  ]);
}
