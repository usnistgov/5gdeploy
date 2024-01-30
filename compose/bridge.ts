import assert from "minimalistic-assert";
import { ip2long, Netmask } from "netmask";
import type { InferredOptionTypes, Options as YargsOptions } from "yargs";

import type { ComposeFile } from "../types/mod.js";
import { defineService, disconnectNetif, setCommands } from "./compose.js";

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

type BridgeBuilder = (c: ComposeFile, net: string, tokens: readonly string[], netIndex: number) => Generator<string, void, void>;

const bridgeModes: Record<string, BridgeBuilder> = {
  *vx(c, net, ips, netIndex) {
    void c;
    assert(ips.length >= 2, "at least 2 hosts");
    assert(ips.every((ip) => ip2long(ip) !== 0), "some IP is invalid");
    yield `msg Setting up VXLAN bridge for br-${net}`;
    yield `pipework --wait -i br-${net}`;
    yield "SELF=''";
    for (const [i, ip] of ips.entries()) {
      yield `if [[ -n "$(ip -o addr show to ${ip})" ]]; then`;
      yield `  SELF=${i}`;
      yield `  SELFIP=${ip}`;
      yield "fi";
    }
    yield "if [[ -z $SELF ]]; then die This host is not part of the bridge; fi";
    for (const [i, ip] of ips.entries()) {
      const netif = `vx-${net}-${i}`;
      yield `if [[ $SELF -ne ${i} ]] && ( [[ $SELF -eq 0 ]] || [[ ${i} -eq 0 ]] ); then`;
      yield `  if [[ $SELF -lt ${i} ]]; then`;
      yield `    VXI=$((${1000000 * netIndex + i} + 1000 * SELF))`;
      yield "  else";
      yield `    VXI=$((${1000000 * netIndex + 1000 * i} + SELF))`;
      yield "  fi";
      yield `  msg Connecting br-${net} to ${ip} on ${netif} with VXLAN id $VXI`;
      yield `  ip link del ${netif} 2>/dev/null || true`;
      yield `  CLEANUPS=$CLEANUPS"; ip link del ${netif} 2>/dev/null || true"`;
      yield `  ip link add ${netif} type vxlan id $VXI remote ${ip} local $SELFIP dstport 4789`;
      yield `  ip link set ${netif} up master br-${net}`;
      yield "fi";
    }
  },
  *eth(c, net, tokens) {
    yield `msg Setting up Ethernet adapters for br-${net}`;
    const cidr = new Netmask(c.networks[net]!.ipam.config[0]!.subnet).bitmask;
    for (const token of tokens) {
      const m = /^(\w+)([=@])((?:[\da-f]{2}:){5}[\da-f]{2})$/i.exec(token);
      assert(m, `invalid parameter ${token}`);
      let [, ct, op, hostif] = m as unknown as [string, string, "=" | "@", string];
      hostif = hostif.toLowerCase();
      const ip = disconnectNetif(c, ct, net);

      yield "I=0; while true; do";
      yield `  case $(docker inspect ${ct} --format='{{.State.Running}}' 2>/dev/null || echo none) in`;
      yield "    false)";
      yield "      I=$((I+1))";
      yield "      if [[ $I -eq 1 ]]; then";
      yield `        msg Waiting for container ${ct} to start`;
      yield "      fi";
      yield "      sleep 1 ;;";
      yield "    true)";
      switch (op) {
        case "=": {
          yield `      msg Using physical interface ${hostif} as ${ct}:${net}`;
          yield `      pipework --direct-phys mac:${hostif} -i ${net} ${ct} ${ip}/${cidr}`;
          break;
        }
        case "@": {
          const macaddr = `52:00${ip2long(ip).toString(16).padStart(8, "0").replaceAll(/([\da-f]{2})/g, ":$1")}`;
          yield `      msg Using MACVLAN ${macaddr} on ${hostif} as ${ct}:${net}`;
          yield `      pipework mac:${hostif} -i ${net} ${ct} ${ip}/${cidr} ${macaddr}`;
          break;
        }
      }
      yield "      break ;;";
      yield "    *none)";
      yield "      break ;;";
      yield "  esac";
      yield "done";
    }
  },
};

/**
 * Define a bridge container.
 * @param c Compose file.
 * @param bridgeArgs command line `--bridge` arguments.
 */
export function defineBridge(c: ComposeFile, opts: InferredOptionTypes<typeof bridgeOptions>): void {
  if (!opts.bridge) {
    return;
  }

  const modes = new Set<string>();
  const commands = [
    "CLEANUPS='set -euo pipefail'",
    "cleanup() {",
    "  msg Performing cleanup",
    "  ash -c \"$CLEANUPS\"",
    "}",
    "trap cleanup SIGTERM",
  ];
  for (const [i, bridgeArg] of opts.bridge.entries()) {
    const tokens = bridgeArg.split(",");
    assert(tokens.length >= 2);
    const net = tokens.shift()!;
    const mode = tokens.shift()!;
    assert(c.networks[net], `unknown network ${net}`);
    const impl = bridgeModes[mode];
    assert(impl, `unknown mode ${mode}`);
    modes.add(mode);
    commands.push(...impl(c, net, tokens, i));
  }
  commands.push(
    "msg Idling",
    "tail -f &",
    "wait $!",
  );

  const s = defineService(c, "bridge", bridgeDockerImage);
  s.network_mode = "host";
  s.cap_add.push("NET_ADMIN");
  if (modes.has("eth")) {
    s.privileged = true;
    s.pid = "host";
    s.volumes.push({
      type: "bind",
      source: "/var/run/docker.sock",
      target: "/var/run/docker.sock",
    });
  }
  setCommands(s, commands, "ash");
}
