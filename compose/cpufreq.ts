import { scriptCleanup, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { annotate } from "./compose.js";
import type { ComposeContext } from "./context.js";
import { setCommands } from "./snippets.js";

export const cpufreqOptions = {
  cpufreq: {
    choices: [0, 1, 2],
    default: 1,
    desc: "CPUFreq settings: 0 - none, 1 - performance governor, 2 - also disable sleep states",
    type: "number",
  },
} as const satisfies YargsOptions;

/** Define a service to configure CPU frequency and sleep states. */
export function makeCpufreqService(c: ComposeContext, opts: YargsInfer<typeof cpufreqOptions>, ct = "cpufreq"): void {
  if (opts.cpufreq < 1) {
    return;
  }

  const s = c.defineService(ct, "alpine:3.20", []);
  s.network_mode = "none";
  s.privileged = true;
  annotate(s, "every_host", 1);

  setCommands(s, [
    ...scriptCleanup({ shell: "ash" }),
    ...(opts.cpufreq >= 1 ? [
      "",
      "if [[ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]]; then",
      "  msg Setting CPUFreq governor",
      "  echo performance | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor",
      "else",
      "  msg Unable to set CPUFreq governor",
      "fi",
    ] : []),
    ...(opts.cpufreq >= 2 ? [
      "",
      "if [[ -f /sys/devices/system/cpu/cpu0/cpuidle/state0/disable ]]; then",
      "  msg Disabling CPU sleep states",
      "  echo 1 | tee /sys/devices/system/cpu/cpu*/cpuidle/state*/disable",
      "  CLEANUPS=$CLEANUPS\"; echo 0 | tee /sys/devices/system/cpu/cpu*/cpuidle/state*/disable\"",
      "else",
      "  msg Unable to disable CPU sleep states",
      "fi",
    ] : []),
    "",
    "msg Idling",
    "tail -f &",
    "wait $!",
  ], { shell: "ash" });
}
