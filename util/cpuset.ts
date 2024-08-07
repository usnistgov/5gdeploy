import * as shlex from "shlex";
import assert from "tiny-invariant";

/**
 * Interpret cpuset string.
 * @returns List of available cores.
 */
export function parseCpuset(cpuset: string): number[] {
  const list: number[] = [];
  for (const token of cpuset.split(",")) {
    const [firstS, lastS] = token.split("-");
    const first = Number.parseInt(firstS!, 10);
    assert(first >= 0, "bad cpuset");

    if (lastS === undefined) {
      list.push(first);
      continue;
    }

    const last = Number.parseInt(lastS, 10);
    assert(last >= first, "bad cpuset");
    for (let i = first; i <= last; ++i) {
      list.push(i);
    }
  }
  return list;
}

/**
 * Generate commands for CPU isolation.
 * @param system - Cores for rest of system.
 * @param docker - Cores for Docker containers.
 */
export function* setupCpuIsolation(system: readonly number[], docker: readonly number[]): Iterable<string> {
  yield* setupCpuIsolationUnit("init.scope", system);
  yield* setupCpuIsolationUnit("service", system);
  yield* setupCpuIsolationUnit("user.slice", system);
  yield* setupCpuIsolationUnit("docker-.scope", docker);
}

function* setupCpuIsolationUnit(unit: string, cores: readonly number[]): Iterable<string> {
  const sectionLower = unit.split(".").at(-1)!;
  const section = sectionLower.slice(0, 1).toUpperCase() + sectionLower.slice(1);
  const conf = `[${section}]\nAllowedCPUs=${cores.join(",")}`;
  yield `mkdir -p /etc/systemd/system/${unit}.d`;
  yield `echo ${shlex.quote(conf)} >/etc/systemd/system/${unit}.d/cpuset.conf`;
}
