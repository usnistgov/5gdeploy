import { minimatch } from "minimatch";
import { ip2long, long2ip, Netmask } from "netmask";
import type { Except } from "type-fest";

import type { ComposeFile } from "../types/mod.js";
import { assert, indentLines, joinVbar, scriptCleanup, splitVbar, YargsCoercedArray, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { annotate, disconnectNetif, ip2mac } from "./compose.js";
import type { ComposeContext } from "./context.js";
import { setCommandsFile } from "./snippets.js";

export const bridgeDockerImage = "5gdeploy.localhost/bridge";

/** Yargs options definition for bridge container. */
export const bridgeOptions = {
  bridge: YargsCoercedArray({
    coerce(line) {
      if (!line.includes("|")) {
        const [net, mode, ...rest] = line.split(",");
        line = [net, mode, rest.join(mode === "vx" ? "," : " ")].join(" | ");
      }
      return splitVbar("bridge", line, 3, 3);
    },
    desc: "bridge a network over several hosts",
  }),
} as const satisfies YargsOptions;
export namespace bridgeOptions {
  export type ResolveFn = (net: string, ip: string) => string | undefined;
}
type BridgeOpts = YargsInfer<typeof bridgeOptions>;

abstract class BridgeMode {
  public abstract build(c: ComposeFile, net: string, params: readonly string[], netIndex: number): Iterable<string>;
  public resolve?: (net: string, ref: string) => string | undefined;
}

class BridgeModeVxlan extends BridgeMode {
  public override *build(c: ComposeFile, net: string, params: readonly string[], netIndex: number): Iterable<string> {
    void c;
    for (const [i, line] of params.entries()) {
      const ipset = Array.from(line.split(","), (ip) => this.resolve?.(net, ip) ?? long2ip(ip2long(ip)));
      yield* this.buildIpset(net, ipset, netIndex, i);
    }
  }

  private *buildIpset(net: string, ipset: readonly string[], netIndex: number, ipsetIndex: number): Iterable<string> {
    const vniBase = 100000 * netIndex + 10000 * ipsetIndex;
    yield "";
    yield `# ipset ${ipsetIndex}`;

    // Find current host in ipset.
    // SELF= index into ipset that current host is assigned
    // SELFIP= the corresponding IP address
    yield `SELF=0; for SELFIP in ${ipset.join(" ")}; do`;
    yield " [[ -n \"$(ip -o addr show to $SELFIP)\" ]] && break";
    yield "  SELF=$((SELF+1))";
    yield "done";

    yield `if [[ $SELF -lt ${ipset.length} ]]; then`;
    yield `  msg Setting up VXLAN bridge for br-${net}`;
    yield `  pipework --wait -i br-${net}`;

    yield* indentLines(this.buildTunnels(`vx-${net}-${ipsetIndex}`, ipset, `br-${net}`, vniBase));
    yield "fi";
  }

  private *buildTunnels(netifPrefix: string, ipset: readonly string[], br: string, vniBase: number): Iterable<string> {
    // Unicast VXLAN tunnels are created between first host (SELF=0) and each subsequent host.
    // VNI= 100000*netIndex + 10000*ipsetIndex + 100*MIN(SELF,PEER) + 1*MAX(SELF,PEER)
    yield `PEER=0; for PEERIP in ${ipset.join(" ")}; do`;
    yield "  if [[ $SELF -ne $PEER ]] && ( [[ $SELF -eq 0 ]] || [[ $PEER -eq 0 ]] ); then";
    yield "    if [[ $SELF -lt $PEER ]]; then";
    yield `      VNI=$((${vniBase} + 100 * SELF + PEER))`;
    yield "    else";
    yield `      VNI=$((${vniBase} + 100 * PEER + SELF))`;
    yield "    fi";
    yield `    NETIF=${netifPrefix}-$PEER`;
    yield `    msg Connecting ${br} to $PEERIP on $NETIF with VXLAN id $VNI`;
    yield "    ip link del $NETIF 2>/dev/null || true";
    yield "    CLEANUPS=$CLEANUPS\"; ip link del $NETIF 2>/dev/null || true\"";
    yield "    ip link add $NETIF type vxlan id $VNI remote $PEERIP local $SELFIP dstport 4789";
    yield `    ip link set $NETIF up master ${br}`;
    yield "  fi";
    yield "  PEER=$((PEER+1))";
    yield "done";

    // for (const [i, ip] of ipset.entries()) {
    //   const netif = `${netifPrefix}-${i}`;
    //   yield `if [[ $SELF -ne ${i} ]] && ( [[ $SELF -eq 0 ]] || [[ ${i} -eq 0 ]] ); then`;
    //   yield `  if [[ $SELF -lt ${i} ]]; then`;
    //   yield `    VNI=$((${vniBase + i} + 100 * SELF))`;
    //   yield "  else";
    //   yield `    VNI=$((${vniBase + 100 * i} + SELF))`;
    //   yield "  fi";
    //   yield `  msg Connecting ${br} to ${ip} on ${netif} with VXLAN id $VNI`;
    //   yield `  ip link del ${netif} 2>/dev/null || true`;
    //   yield `  CLEANUPS=$CLEANUPS"; ip link del ${netif} 2>/dev/null || true"`;
    //   yield `  ip link add ${netif} type vxlan id $VNI remote ${ip} local $SELFIP dstport 4789`;
    //   yield `  ip link set ${netif} up master ${br}`;
    //   yield "fi";
    // }
  }
}

interface EthPortDef {
  ct: string;
  op: "=" | "@" | "~";
  hostif: string;
  vlan?: number;
  rss?: {
    start: number;
    equal: number;
    input: "s" | "d";
  };
}

class BridgeModeEth extends BridgeMode {
  public *build(c: ComposeFile, net: string, params: readonly string[]): Iterable<string> {
    yield `msg Setting up Ethernet adapters for br-${net}`;
    const cidr = new Netmask(c.networks[net]!.ipam.config[0]!.subnet).bitmask;
    const cts = new Set(Object.keys(c.services).filter((ct) => c.services[ct]!.networks[net]));
    for (const param of params) {
      for (const def of this.parsePorts(net, param, cts)) {
        yield* this.buildPort(c, net, cidr, def);
      }
    }
  }

  private *parsePorts(net: string, param: string, cts: Set<string>): Iterable<EthPortDef> {
    const errHdr = `BridgeModeEth(${param})`;
    const m = /([=@~])(.*?)(?:\+vlan(\d+))?(?:\+rss(\d+)\/(\d+)([sd]))?$/i.exec(param);
    assert(m, `${errHdr}: bad syntax`);
    const def: Except<EthPortDef, "ct" | "hostif"> = {
      op: m[1] as EthPortDef["op"],
    };
    const hostifs = Array.from(m[2]!.split(","), (hostif) => {
      hostif = this.resolve?.(net, hostif) ?? hostif;
      assert(/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(hostif), `${errHdr}: bad MAC address`);
      return hostif.toLowerCase();
    });

    if (m[3]) {
      def.vlan = Number.parseInt(m[3], 10);
      assert(def.vlan >= 1 && def.vlan < 4095, `${errHdr}: bad VLAN ID`);
    }

    if (m[6]) {
      assert(def.op === "=", `${errHdr}: +rss only allowed with '='`);
      def.rss = {
        start: Number.parseInt(m[4]!, 10),
        equal: Number.parseInt(m[5]!, 10),
        input: m[6] as "s" | "d",
      };
      assert([1, 2, 4, 8, 16].includes(def.rss.equal),
        `${errHdr}: +rss expects 1, 2, 4, 8, or 16 queues`);
    }

    const ctPattern = param.slice(0, -m[0].length);
    const matched = minimatch.match(Array.from(cts), ctPattern);
    switch (def.op) {
      case "=": {
        assert(matched.length >= hostifs.length,
          `${errHdr}: ${matched.length} containers do not fit in ${hostifs.length} hostifs`);
        break;
      }
      case "~": {
        assert(matched.length === 1,
          `${errHdr}: exactly one container required for '~' operator`);
        // fallthrough
      }
      case "@": {
        assert(hostifs.length === 1,
          `${errHdr}: exactly one hostif required for '${def.op}' operator`);
        break;
      }
    }

    for (const [i, ct] of matched.entries()) {
      yield { ...def, ct, hostif: hostifs[i] ?? hostifs[0]! };
      cts.delete(ct);
    }
  }

  private *buildPort(c: ComposeFile, net: string, cidr: number, { ct, op, hostif, vlan, rss }: EthPortDef): Iterable<string> {
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
        if (rss) {
          yield `      msg Setting Toeplitz hash function on ${ct}:${net}`;
          yield `      toeplitz.sh ${ct}:${net} ${rss.start} ${rss.equal} ${rss.input}`;
        }
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

const bridgeModes = {
  vx: new BridgeModeVxlan(),
  eth: new BridgeModeEth(),
} satisfies Record<string, BridgeMode>;

/** Assign a function to resolve address reference in bridge parameters. */
export function setBridgeResolveFn(mode: keyof typeof bridgeModes, fn: BridgeMode["resolve"]): void {
  bridgeModes[mode].resolve = fn;
}

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
    }, {
      type: "bind",
      source: "/var/run/docker/netns",
      target: "/var/run/netns",
      bind: {
        propagation: "shared",
        create_host_path: true,
      },
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

  for (const [i, [net, mode, param]] of opts.bridge.entries()) {
    assert(c.networks[net], `unknown network ${net}`);
    assert(mode in bridgeModes, `unknown mode ${mode}`);
    modes.add(mode);
    yield "";
    yield `# ${joinVbar("bridge", [net, mode, param])}`;
    yield* bridgeModes[mode as keyof typeof bridgeModes].build(c, net, param.split(/\s+/), i);
    yield "";
  }

  yield "msg Setting healthy state";
  yield `touch ${healthyFile}`;

  yield* scriptCleanup.idling;
}

const healthyFile = "/run/5gdeploy-bridge-is-healthy";
