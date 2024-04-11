import { assert } from "node:console";

import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import { map } from "obliterator";
import * as shlex from "shlex";
import type { ReadonlyDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import type { ComposeFile, ComposeService, ComposeVolume } from "../types/compose";
import { hexPad, type YargsInfer, type YargsOptions } from "../util/mod.js";
import type { NetDefComposeContext } from "./context.js";

interface BaseRule {
  flag: string;
  net: string;
  src: Minimatch;
  dst: Minimatch;
}

interface DSCPRule extends BaseRule {
  dscp: number;
}

interface NetemRule extends BaseRule {
  netem: string;
}

function extractBaseRule(flagName: string, line: string, expectedTokens: number): [rule: BaseRule, tokens: string[]] {
  const tokens = Array.from(line.split("|"), (token) => token.trim());
  assert(tokens.length === 3 + expectedTokens, `bad --${flagName} ${line}`);
  const flag = `--${flagName}=${shlex.quote(tokens.join("|"))}`;
  const [net, src, dst] = tokens.splice(0, 3) as [string, string, string];
  return [{ flag, net, src: new Minimatch(src), dst: new Minimatch(dst) }, tokens];
}

export const qosOptions = {
  "set-dscp": {
    array: true,
    coerce(lines: readonly string[]): DSCPRule[] {
      return Array.from(lines, (line) => {
        const [br, tokens] = extractBaseRule("set-dscp", line, 1);
        const dscp = Number.parseInt(tokens[0]!, 0); // eslint-disable-line radix
        assert(Number.isInteger(dscp) && dscp >= 0 && dscp < 64, `bad DSCP in --set-dscp ${line}`);
        return { ...br, dscp };
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
        const [br, tokens] = extractBaseRule("set-netem", line, 1);
        return { ...br, netem: shlex.join(shlex.split(tokens[0]!)) };
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

/**
 * Generate commands to apply QoS rules.
 * @param s - Compose service.
 */
export function* applyQoS(s: ComposeService, shell = "bash"): Iterable<string> {
  s.volumes.push(qosVolume);
  yield `${shell} ${qosVolume.target}`;
}

export async function saveQoS(ctx: NetDefComposeContext, opts: QoSOpts): Promise<void> {
  await ctx.writeFile(qosVolume.source, Array.from(generateScript(ctx.c, opts)).join("\n"));
}

function* generateScript(c: ComposeFile, opts: QoSOpts): Iterable<string> {
  yield* compose.scriptHead;
  yield "QOS_HOSTNAME=$(hostname -s)";
  yield "QOS_HAS_MANGLE=0";
  yield "QOS_TC_DEVICES=()";

  for (const s of Object.values(c.services)) {
    yield "";
    if (!s.volumes.some((vol) => vol.source === qosVolume.source)) {
      yield `# ${s.container_name} does not support QoS rules`;
      continue;
    }

    yield `if [[ $QOS_HOSTNAME == ${s.container_name} ]]; then`;
    yield* map(generateScriptForContainer(c, s, opts), (line) => line === "" ? line : `  ${line}`);
    yield "fi";

    yield "";
    yield "if [[ $QOS_HAS_MANGLE -eq 1 ]]; then";
    yield "  msg iptables mangle table listing:";
    yield "  iptables -t mangle -L OUTPUT";
    yield "fi";
    yield "for QOS_TC_DEVICE in \"${QOS_TC_DEVICES[@]}\"; do"; // eslint-disable-line no-template-curly-in-string
    yield "  msg tc filter listing for $QOS_TC_DEVICE";
    yield "  tc -p filter show dev $QOS_TC_DEVICE";
    yield "  msg tc qdisc listing for $QOS_TC_DEVICE";
    yield "  tc -p qdisc show dev $QOS_TC_DEVICE";
    yield "done";
    // yield "if [[ ${#QOS_TC_DEVICES[@]} -gt 0 ]]; then";
    // yield "  msg tc filter listing:";
    // yield "  printf \"%s\\0\" \"${QOS_TC_DEVICES[@]}\" | xargs -0 -n1 tc -p filter show dev";
    // yield "  msg tc qdisc listing:";
    // yield "  printf \"%s\\0\" \"${QOS_TC_DEVICES[@]}\" | xargs -0 -n1 tc -p qdisc show dev";
    // yield "fi";
  }
}

function* generateScriptForContainer(c: ComposeFile, s: ComposeService, opts: QoSOpts): Iterable<string> {
  yield "msg Applying QoS rules";
  let hasMangle = false;
  for (const rule of listRules(c, s, opts["set-dscp"])) {
    yield `# DSCP rule ${rule.index} ${rule.flag}`;
    for (const dstIP of rule.dstIPs) {
      yield `iptables -t mangle -A OUTPUT -s ${rule.srcIP} -d ${dstIP} -j DSCP --set-dscp ${rule.dscp}`;
      hasMangle = true;
    }
  }
  if (hasMangle) {
    yield "QOS_HAS_MANGLE=1";
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
        for (const dstIP of rule.dstIPs) {
          yield `tc filter replace dev ${netif} parent 1: protocol ip prio 1 u32 match ip dst ${dstIP} flowid 1:${hexPad(minor, 4)}`;
        }
      }
      yield `tc qdisc replace dev ${netif} parent 1:${hexPad(minor, 4)
      } handle ${hexPad(0x8000 + minor, 4)}: netem ${param}`;
    }
    yield `QOS_TC_DEVICES+=(${netif})`;
  }
}

interface RuleInfo {
  index: number;
  srcIP: string;
  dstIPs: string[];
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

    const srcIP = compose.annotate(s, `ip_${rule.net}`);
    assert(!!srcIP, `${s.container_name} does not have ${rule.net} netif`);

    const dstIPs: string[] = [];
    for (const dst of Object.values(c.services)) {
      if (!rule.dst.match(dst.container_name)) {
        continue;
      }

      const dstIP = compose.annotate(dst, `ip_${rule.net}`);
      if (dstIP) {
        dstIPs.push(dstIP);
      }
    }

    if (dstIPs.length > 0) {
      yield { ...rule, index, srcIP: srcIP!, dstIPs };
    }
  }
}
