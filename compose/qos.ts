import { assert } from "node:console";

import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import map from "obliterator/map.js";
import * as shlex from "shlex";
import type { ReadonlyDeep } from "type-fest";

import type { ComposeFile, ComposeService, ComposeVolume } from "../types/mod.js";
import { hexPad, joinVbar, scriptHead, splitVbar, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { annotate } from "./compose.js";
import type { ComposeContext } from "./context.js";

interface BaseRule {
  flag: string;
  net: string;
  src: Minimatch;
  dst: Minimatch;
}

function buildBaseRule(name: string, tokens: readonly [string, string, string, ...readonly string[]]): BaseRule {
  return {
    flag: joinVbar(name, tokens),
    net: tokens[0],
    src: new Minimatch(tokens[1]),
    dst: new Minimatch(tokens[2]),
  };
}

interface DSCPRule extends BaseRule {
  dscp: number;
}

interface NetemRule extends BaseRule {
  netem: string;
}

export const qosOptions = {
  "set-dscp": {
    array: true,
    coerce(lines: readonly string[]): DSCPRule[] {
      return Array.from(lines, (line) => {
        const tokens = splitVbar("set-dscp", line, 4, 4);
        const dscp = Number.parseInt(tokens[3], 0); // eslint-disable-line radix
        assert(Number.isInteger(dscp) && dscp >= 0 && dscp < 64, `bad DSCP in --set-dscp ${line}`);
        return { ...buildBaseRule("set-dscp", tokens), dscp };
      });
    },
    default: [],
    desc: "alter outer IPv4 DSCP",
    nargs: 1,
    type: "string",
  },
  "set-netem": {
    array: true,
    coerce(lines: readonly string[]): NetemRule[] {
      return Array.from(lines, (line) => {
        const tokens = splitVbar("set-netem", line, 4, 4);
        const netem = shlex.join(shlex.split(tokens[3]));
        return { ...buildBaseRule("set-netem", tokens), netem };
      });
    },
    default: [],
    desc: "set sch_netem parameters",
    nargs: 1,
    type: "string",
  },
} satisfies YargsOptions;
type QoSOpts = YargsInfer<typeof qosOptions>;

const qosVolume: ComposeVolume = {
  type: "bind",
  source: "./qos.sh",
  target: "/qos.sh",
  read_only: true,
};

function hasQoSVolume(s: ComposeService): boolean {
  return s.volumes.some((vol) => vol.source === qosVolume.source);
}

/**
 * Generate commands to apply QoS rules.
 * @param s - Compose service.
 * @param shell - Shell program. This should be set to `ash` for alpine based images.
 *
 * @remarks
 * These commands should be included in each container that supports QoS rules.
 * This requires `iptables` and `tc` to be installed in the container.
 */
export function* applyQoS(s: ComposeService, shell = "bash"): Iterable<string> {
  s.cap_add.push("NET_ADMIN");
  s.volumes.push(qosVolume);
  yield `${shell} ${qosVolume.target} ${s.container_name}`;
}

/**
 * Save QoS rules.
 * @param ctx - Compose context.
 * @param opts - QoS related options.
 *
 * @remarks
 * This should be called once after all containers that may support QoS rules are defined.
 */
export async function saveQoS(ctx: ComposeContext, opts: QoSOpts): Promise<void> {
  if (!Object.values(ctx.c.services).some((s) => hasQoSVolume(s))) {
    return;
  }
  await ctx.writeFile(qosVolume.source, generateScript(ctx.c, opts), { executable: false });
}

function* generateScript(c: ComposeFile, opts: QoSOpts): Iterable<string> {
  yield* scriptHead;
  yield "CT=\"$1\"";
  yield "HAS_MANGLE=0";
  yield "TC_DEVICES=''";

  for (const s of Object.values(c.services)) {
    if (!hasQoSVolume(s)) {
      continue;
    }

    yield "";
    yield `if [[ $CT == ${s.container_name} ]]; then`;
    yield* map(generateScriptForContainer(c, s, opts), (line) => line === "" ? line : `  ${line}`);
    yield "fi";
  }

  yield "";
  yield "if [[ $HAS_MANGLE -eq 1 ]]; then";
  yield "  msg Listing iptables mangle table";
  yield "  iptables -t mangle -L OUTPUT";
  yield "fi";
  yield "for TC_DEVICE in $TC_DEVICES; do";
  yield "  msg Listing tc filters on $TC_DEVICE";
  yield "  tc -p filter show dev $TC_DEVICE";
  yield "  msg Listing tc queueing disciplines on $TC_DEVICE";
  yield "  tc -p qdisc show dev $TC_DEVICE";
  yield "done";
}

function* generateScriptForContainer(c: ComposeFile, s: ComposeService, opts: QoSOpts): Iterable<string> {
  yield "msg Applying QoS rules";
  let hasMangle = false;
  for (const rule of listRules(c, s, opts["set-dscp"])) {
    yield `# DSCP rule ${rule.index} ${rule.flag}`;
    for (const dstIP of rule.dstSubnets) {
      yield `iptables -t mangle -A OUTPUT -s ${rule.srcIP} -d ${dstIP} -j DSCP --set-dscp ${rule.dscp}`;
      hasMangle = true;
    }
  }
  if (hasMangle) {
    yield "HAS_MANGLE=1";
  }

  const netemDevices = new DefaultMap((netif: string) => {
    void netif;
    return new DefaultMap((params: string, size) => {
      void params;
      return {
        minor: 1 + size,
        rules: [] as Array<ReadonlyDeep<NetemRule & RuleInfo>>,
      };
    });
  });
  for (const rule of listRules(c, s, opts["set-netem"])) {
    netemDevices.get(rule.net).get(rule.netem).rules.push(rule);
  }

  for (const [netif, dev] of netemDevices) {
    yield "";
    yield `# netem device ${netif}`;
    yield `tc qdisc replace dev ${netif} root handle 1: prio bands ${1 + dev.size} priomap ${
      Array.from({ length: 16 }, () => dev.size).join(" ")}`;
    yield `tc filter replace dev ${netif} parent 1: handle 2000 protocol all prio 2 matchall flowid 1:FFFE`;
    for (const [param, { minor, rules }] of dev) {
      for (const rule of rules) {
        yield `# netem rule ${rule.index} ${rule.flag}`;
        for (const dstIP of rule.dstSubnets) {
          yield `tc filter replace dev ${netif} parent 1: protocol ip prio 1 u32 match ip dst ${dstIP} flowid 1:${hexPad(minor, 4)}`;
        }
      }
      yield `tc qdisc replace dev ${netif} parent 1:${hexPad(minor, 4)
      } handle ${hexPad(0x8000 + minor, 4)}: netem ${param}`;
    }
    yield `TC_DEVICES="$TC_DEVICES ${netif}"`;
  }
}

interface RuleInfo {
  index: number;
  srcIP: string;
  dstSubnets: string[];
}

function* listRules<R extends ReadonlyDeep<BaseRule>>(
    c: ComposeFile,
    s: ComposeService,
    opt: readonly R[],
): Iterable<R & RuleInfo> {
  for (const [index, rule] of opt.entries()) {
    if (!rule.src.match(s.container_name)) {
      continue;
    }

    const srcIP = annotate(s, `ip_${rule.net}`);
    assert(!!srcIP, `${s.container_name} does not have ${rule.net} netif`);

    const dstSubnets: string[] = [];
    if (rule.dst.pattern === "*") {
      const net = c.networks[rule.net];
      assert(!!net, `network ${rule.net} does not exist`);
      dstSubnets.push(`${net!.ipam.config[0]!.subnet}`);
    } else {
      for (const dst of Object.values(c.services)) {
        if (!rule.dst.match(dst.container_name)) {
          continue;
        }

        const dstIP = annotate(dst, `ip_${rule.net}`);
        if (dstIP) {
          dstSubnets.push(`${dstIP}/32`);
        }
      }
    }

    if (dstSubnets.length > 0) {
      yield { ...rule, index, srcIP: srcIP!, dstSubnets };
    }
  }
}
