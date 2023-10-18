import assert from "minimalistic-assert";
import { ip2long, Netmask } from "netmask";
import type { InferredOptionTypes, Options as YargsOptions } from "yargs";

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

type BridgeBuilder = (c: ComposeFile, network: string, tokens: readonly string[], networkIndex: number) => Generator<string, void, void>;

function pipeworkBridge(
    mode: string,
    cmd: (hostif: string, ct: string, ifname: string, ip: string, cidr: number) => Iterable<string>,
): BridgeBuilder {
  return function*(c, network, tokens) {
    assert(tokens.length === 2, `network,${mode},ct,macaddr`);
    let [ct, macaddr] = tokens as [string, string];

    const s = c.services[ct];
    assert(s);
    const netif = s.networks[network];
    assert(netif);
    delete s.networks[network]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
    const cidr = new Netmask(c.networks[network]!.ipam.config[0]!.subnet).bitmask;

    const sysctlPrefix = `net.ipv4.conf.eth${Object.entries(s.networks).length}`;
    for (const key of Object.keys(s.sysctls)) {
      if (key.startsWith(sysctlPrefix)) {
        delete s.sysctls[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
      }
    }

    macaddr = macaddr.toLowerCase();
    assert(/^(?:[\da-f]{2}:){5}[\da-f]{2}$/.test(macaddr));
    yield "I=0; while true; do";
    yield `  case $(docker inspect ${ct} --format='{{.State.Running}}' 2>/dev/null || echo none) in`;
    yield "    false)";
    yield "      I=$((I+1))";
    yield "      if [[ $I -eq 1 ]]; then";
    yield `        msg Waiting for container ${ct} to start`;
    yield "      fi";
    yield "      sleep 1 ;;";
    yield "    true)";
    yield* Array.from(cmd(macaddr, ct, network, netif.ipv4_address, cidr), (line) => `      ${line}`);
    yield "      break ;;";
    yield "    *none)";
    yield "      break ;;";
    yield "  esac";
    yield "done";
  };
}

const bridgeModes: Record<string, BridgeBuilder> = {
  *vx(c, network, tokens, networkIndex) {
    void c;
    yield `msg Setting up VXLAN bridge for br-${network}`;
    yield `pipework --wait -i br-${network}`;
    yield "SELF=''";
    const ips = tokens.map((ip) => new Netmask(ip, "32").base);
    assert(ips.length >= 2, "at least 2 hosts");
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
  phy: pipeworkBridge("phy", function*(hostif, ct, ifname, ip, cidr) {
    yield `msg Using physical interface ${hostif} as ${ct}:${ifname}`;
    yield `pipework --direct-phys mac:${hostif} -i ${ifname} ${ct} ${ip}/${cidr}`;
  }),
  macvlan: pipeworkBridge("macvlan", function*(hostif, ct, ifname, ip, cidr) {
    const macaddr = `52:00${ip2long(ip).toString(16).padStart(8, "0").replaceAll(/([\da-f]{2})/g, ":$1")}`;
    yield `msg Using MACVLAN ${macaddr} on ${hostif} as ${ct}:${ifname}`;
    yield `pipework mac:${hostif} -i ${ifname} ${ct} ${ip}/${cidr} ${macaddr}`;
  }),
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
    const network = tokens.shift()!;
    const mode = tokens.shift()!;
    assert(c.networks[network], `unknown network ${network}`);
    const impl = bridgeModes[mode];
    assert(impl, `unknown mode ${mode}`);
    modes.add(mode);
    commands.push(...impl(c, network, tokens, i));
  }
  commands.push(
    "msg Idling",
    "tail -f &",
    "wait $!",
  );

  const s = defineService(c, "bridge", bridgeDockerImage);
  s.network_mode = "host";
  s.cap_add.push("NET_ADMIN");
  if (modes.has("phy") || modes.has("macvlan")) {
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
