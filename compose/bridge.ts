import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import type { Options as YargsOptions } from "yargs";

import type { ComposeFile } from "../types/compose.js";
import { defineService, setCommands } from "./compose.js";

export const bridgeDockerImage = "5gdeploy.localhost/bridge";

/** yargs options definition for bridge container. */
export const bridgeOptions = {
  bridge: {
    desc: "bridge a network over several hosts",
    nargs: 1,
    string: true,
    type: "array",
  },
} as const satisfies Record<string, YargsOptions>;

const bridgeModes: Record<string, (c: ComposeFile, network: string, tokens: readonly string[], networkIndex: number) => Generator<string, void, void>> = {
  *vx(c, network, tokens, networkIndex) {
    void c;
    yield `msg Setting up VXLAN bridge for br-${network}`;
    yield `pipework --wait -i br-${network}`;
    yield "SELF=''";
    const ips = tokens.map((ip) => new Netmask(ip, "32").base);
    for (const [i, ip] of ips.entries()) {
      yield `if [[ $(ip -j route get ${ip} | jq -r '.[].prefsrc') == ${ip} ]]; then SELF=${i}; fi`;
    }
    yield "if [[ -z $SELF ]]; then die This host is not part of the bridge; fi";
    for (const [i, ip] of ips.entries()) {
      const netif = `vx-${network}-${i}`;
      yield `if [[ $SELF -ne ${i} ]] && ( [[ $SELF -eq 0 ]] || [[ ${i} -eq 0 ]] ); then`;
      yield `  if [[ $SELF -lt ${i} ]]; then`;
      yield `    VXI=$((${1000000 * networkIndex + i} + 1000 * SELF))`;
      yield "  else";
      yield `    VXI=$((${1000000 * networkIndex + 1000 * i} + SELF))`;
      yield "  fi";
      yield `  msg Connecting br-${network} to ${ip} on ${netif} with VXLAN id $VXI`;
      yield `  ip link del ${netif} 2>/dev/null || true`;
      yield `  CLEANUPS=$CLEANUPS"; ip link del ${netif} 2>/dev/null || true"`;
      yield `  ip link add ${netif} type vxlan id $VXI remote ${ip} dstport 4789`;
      yield `  ip link set ${netif} up master br-${network}`;
      yield "fi";
    }
  },
};

/**
 * Define a bridge container.
 * @param c Compose file.
 * @param bridgeArgs command line `--bridge` arguments.
 */
export function defineBridge(c: ComposeFile, bridgeArgs: readonly string[]): void {
  const commands = [
    "CLEANUPS='set -euo pipefail'",
    "cleanup() {",
    "  msg Performing cleanup",
    "  ash -c \"$CLEANUPS\"",
    "}",
    "trap cleanup SIGTERM",
  ];
  for (const [i, bridgeArg] of bridgeArgs.entries()) {
    const tokens = bridgeArg.split(",");
    assert(tokens.length >= 4, "bridge must have at least 2 hosts");
    const network = tokens.shift()!;
    const mode = tokens.shift()!;
    assert(c.networks[network], `unknown network ${network}`);
    const impl = bridgeModes[mode];
    assert(impl, `unknown mode ${mode}`);
    commands.push(...impl(c, network, tokens, i));
  }
  commands.push(
    "msg Idling",
    "tail -f &",
    "wait $!",
  );

  const service = defineService(c, "bridge", bridgeDockerImage);
  service.network_mode = "host";
  service.cap_add.push("NET_ADMIN");
  setCommands(service, commands, "ash");
}
