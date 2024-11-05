import { minimatch } from "minimatch";
import { ip2long, Netmask } from "netmask";
import * as shlex from "shlex";

import type { ComposeFile } from "../types/mod.js";
import { assert, scriptCleanup, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { annotate, disconnectNetif, ip2mac } from "./compose.js";
import type { ComposeContext } from "./context.js";
import { setCommandsFile } from "./snippets.js";

export const bridgeDockerImage = "5gdeploy.localhost/bridge";

/** Yargs options definition for bridge container. */
export const bridgeOptions = {
  bridge: {
    array: true,
    desc: "bridge a network over several hosts",
    nargs: 1,
    type: "string",
  },
} as const satisfies YargsOptions;
type BridgeOpts = YargsInfer<typeof bridgeOptions>;

function* buildVxlan(c: ComposeFile, net: string, ips: readonly string[], netIndex: number): Iterable<string> {
  void c;
  assert(ips.length >= 2, "at least 2 hosts");
  assert(ips.every((ip) => ip2long(ip) !== 0), "some IP is invalid");

  // Find current host in `ips` array.
  // SELF= index into `ips` that current host is assigned
  // SELFIP= the corresponding IP address
  yield "SELF=-1";
  for (const [i, ip] of ips.entries()) {
    yield `if [[ -n "$(ip -o addr show to ${ip})" ]]; then`;
    yield `  SELF=${i}`;
    yield `  SELFIP=${ip}`;
    yield "fi";
  }

  yield "if [[ $SELF -ge 0 ]]; then";
  yield `  msg Setting up VXLAN bridge for br-${net}`;
  yield `  pipework --wait -i br-${net}`;
  yield `elif [[ -n "$(ip -o link show dev br-${net} 2>/dev/null)" ]]; then`;
  yield `  msg "This host is not part of br-${net} but the netif exists. If this is unexpected, assign ${ips.join(" or ")} to a host netif."`;
  yield "fi";

  // Unicast VXLAN tunnels are created between first host (SELF=0) and each subsequent host.
  // VNI= 100000*netIndex + 1000*MIN(SELF,PEER) + 1*MAX(SELF,PEER)
  for (const [i, ip] of ips.entries()) {
    const netif = `vx-${net}-${i}`;
    yield "";
    yield `if [[ $SELF -ge 0 ]] && [[ $SELF -ne ${i} ]] && ( [[ $SELF -eq 0 ]] || [[ ${i} -eq 0 ]] ); then`;
    yield `  if [[ $SELF -lt ${i} ]]; then`;
    yield `    VNI=$((${1000000 * netIndex + i} + 1000 * SELF))`;
    yield "  else";
    yield `    VNI=$((${1000000 * netIndex + 1000 * i} + SELF))`;
    yield "  fi";
    yield `  msg Connecting br-${net} to ${ip} on ${netif} with VXLAN id $VNI`;
    yield `  ip link del ${netif} 2>/dev/null || true`;
    yield `  CLEANUPS=$CLEANUPS"; ip link del ${netif} 2>/dev/null || true"`;
    yield `  ip link add ${netif} type vxlan id $VNI remote ${ip} local $SELFIP dstport 4789`;
    yield `  ip link set ${netif} up master br-${net}`;
    yield "fi";
  }
}

function* parseEthDef(
    c: ComposeFile, net: string, tokens: readonly string[],
): Iterable<[ct: string, op: "=" | "@" | "~", hostif: string, vlan: number | undefined]> {
  const cts = new Set(Object.keys(c.services).filter((ct) => c.services[ct]!.networks[net]));
  for (const token of tokens) {
    const m = /([=@~])((?:[\da-f]{2}:){5}[\da-f]{2})(\+vlan\d+)?$/i.exec(token);
    assert(m, `invalid parameter ${token}`);
    const op = m[1]! as "=" | "@";
    const hostif = m[2]!.toLowerCase();
    const pattern = token.slice(0, -m[0].length);
    const matched = minimatch.match(Array.from(cts), pattern);
    const vlan = m[3] ? Number.parseInt(m[3].slice(5), 10) : undefined;
    assert(matched.length > 0, `${pattern} does not match any container on br-${net}`);
    assert(op === "@" || matched.length === 1, `${pattern} matches multiple containers (${
      matched.join(", ")}) on br-${net} reusing a physical interface`);
    assert(vlan === undefined || (vlan >= 1 && vlan < 4095), "bad VLAN ID");
    for (const ct of matched) {
      yield [ct, op, hostif, vlan];
      cts.delete(ct);
    }
  }
  assert(cts.size === 0,
    `containers ${Array.from(cts).join(", ")} on br-${net} did not match any pattern`);
}

function* buildEthernet(c: ComposeFile, net: string, tokens: readonly string[]): Iterable<string> {
  yield `msg Setting up Ethernet adapters for br-${net}`;
  const cidr = new Netmask(c.networks[net]!.ipam.config[0]!.subnet).bitmask;
  for (const [ct, op, hostif, vlan] of parseEthDef(c, net, tokens)) {
    const ip = disconnectNetif(c, ct, net);
    const vlanDesc = vlan ? ` VLAN ${vlan}` : "";
    const vlanFlag = vlan ? `@${vlan}` : "";

    yield "";
    yield "I=0; while true; do";
    yield `  case $(docker inspect ${ct} --format='{{.State.Running}}' 2>/dev/null || echo none) in`;
    yield "    false)"; // container exists but not started - wait
    yield "      I=$((I+1))";
    yield "      if [[ $I -eq 1 ]]; then";
    yield `        msg Waiting for container ${ct} to start`;
    yield "      fi";
    yield "      sleep 1 ;;";
    yield "    true)"; // container exists and started - execute
    switch (op) {
      case "=": {
        annotate(c.services[ct]!, `mac_${net}`, hostif);
        yield `      msg Using physical interface ${hostif}${vlanDesc} as ${ct}:${net}`;
        yield `      pipework --direct-phys mac:${hostif} -i ${net} ${ct} ${ip}/${cidr} ${vlanFlag}`;
        break;
      }
      case "@": {
        const macaddr = ip2mac(ip);
        yield `      msg Using MACVLAN ${macaddr} on ${hostif}${vlanDesc} as ${ct}:${net}`;
        yield `      pipework mac:${hostif} -i ${net} ${ct} ${ip}/${cidr} ${macaddr} ${vlanFlag}`;
        break;
      }
      case "~": {
        annotate(c.services[ct]!, `mac_${net}`, hostif);
        yield `      msg Assuming ${hostif} is setup as ${ct}:${net}`;
        break;
      }
    }
    yield "      break ;;";
    yield "    *none)"; // container does not exist (i.e. not on current host) - skip
    yield "      break ;;";
    yield "  esac";
    yield "done";
  }
}

const bridgeModes: Record<string, (c: ComposeFile, net: string, tokens: readonly string[], netIndex: number) => Iterable<string>> = {
  vx: buildVxlan,
  eth: buildEthernet,
};

/** Define a bridge container. */
export async function defineBridge(ctx: ComposeContext, opts: BridgeOpts): Promise<void> {
  if (!opts.bridge) {
    return;
  }

  const s = ctx.defineService("bridge", bridgeDockerImage, []);
  annotate(s, "every_host", 1);
  s.network_mode = "host";
  s.cap_add.push("NET_ADMIN");

  const modes = new Set<string>();
  await setCommandsFile(ctx, s, generateScript(ctx.c, opts, modes), { shell: "ash" });

  if (modes.has("eth")) {
    s.privileged = true;
    s.pid = "host";
    s.volumes.push({
      type: "bind",
      source: "/var/run/docker.sock",
      target: "/var/run/docker.sock",
    });
  }

  s.healthcheck = {
    test: ["CMD", "test", "-f", healthyFile],
    interval: "31s",
    start_period: "30s",
  };
}

function* generateScript(c: ComposeFile, opts: BridgeOpts, modes: Set<string>): Iterable<string> {
  yield* scriptCleanup({ shell: "ash" });
  yield "";

  for (const [i, bridgeArg] of opts.bridge!.entries()) {
    const tokens = bridgeArg.split(",");
    assert(tokens.length >= 2);
    const [net, mode, ...rest] = tokens as [string, string, ...string[]];
    assert(c.networks[net], `unknown network ${net}`);
    const impl = bridgeModes[mode];
    assert(impl, `unknown mode ${mode}`);
    modes.add(mode);
    yield "";
    yield `# --bridge=${shlex.quote(bridgeArg)}`;
    yield* impl(c, net, rest, i);
    yield "";
  }

  yield "msg Setting healthy state";
  yield `touch ${healthyFile}`;

  yield* scriptCleanup.idling;
}

const healthyFile = "/run/5gdeploy-bridge-is-healthy";
