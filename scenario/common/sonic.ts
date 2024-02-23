import type { Operation } from "fast-json-patch";
import stringify from "json-stringify-deterministic";
import assert from "minimalistic-assert";
import * as shlex from "shlex";
import type { ArrayValues } from "type-fest";

import { file_io, type YargsInfer, type YargsOpt, type YargsOptions } from "../../util/mod.js";

/** Construct yargs options for SONiC builder basics. */
export function makeOptions(id: string) {
  return {
    op: {
      choices: ["add", "replace", "remove", "drop"],
      default: "replace",
      desc: "JSON patch operation",
      type: "string",
    },
    prefix: {
      default: `5gdeploy-${id}-`,
      desc: "table key prefix",
      type: "string",
    },
    format: {
      choices: ["patch", "pretty", "shell"],
      default: "patch",
      desc: "output format",
      type: "string",
    },
  } as const satisfies YargsOptions;
}

/** Construct yargs option for SONiC scheduler. */
export function schedOption(name: string) {
  return {
    choices: ["STRICT", "WRR", "DWRR"] as const,
    default: "STRICT",
    desc: `${name} scheduler type`,
    type: "string",
  } as const satisfies YargsOpt;
}

type SchedType = ArrayValues<ReturnType<typeof schedOption>["choices"]>;
type TrafficClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** SONiC patch builder. */
export class Builder {
  constructor(private readonly opts: YargsInfer<ReturnType<typeof makeOptions>>) {}

  private readonly tables = new Set<string>();
  private readonly objects = new Map<string, unknown>();

  /**
   * Set an option.
   * @param path - SONiC config_db JSON path.
   * @param value - Desired configuration value.
   *
   * @remarks
   * If the same path is already specified and it's an object, the values are merged.
   */
  public set(path: string, value: unknown): void {
    const table = path.split("/")[1]!;
    this.tables.add(table);

    const old = this.objects.get(path);
    if (typeof old === "object") {
      Object.assign(old!, value);
    } else {
      this.objects.set(path, value);
    }
  }

  /**
   * Assign traffic class unconditionally on packets received on a port.
   * @param name - Rule name.
   * @param port - Ingress port.
   * @param tc - Traffic class, integer between 0 and 7.
   */
  public assignTrafficClass(name: string, port: string, tc: TrafficClass): void {
    assert(/^Ethernet\d+$/.test(port));
    const { prefix } = this.opts;
    this.set(`/DOT1P_TO_TC_MAP/${prefix}${name}`, { 0: `${tc}` });
    this.set(`/PORT_QOS_MAP/${port}`, {
      dot1p_to_tc_map: `${prefix}${name}`,
    });
  }

  /**
   * Assign scheduler for packets queud toward a port.
   * @param name - Rule name.
   * @param port - Egress port.
   * @param type - Scheduler type.
   * @param shapeMbps - Rate shape in Mbps.
   * @param queueWeights - Mapping from queue number to WRR/DWRR weights (1..100).
   */
  public assignScheduler(
      name: string, port: string, type: SchedType, shapeMbps: number,
      queueWeights: Partial<Record<TrafficClass, number>>,
  ): void {
    assert(/^Ethernet\d+$/.test(port));
    const { prefix } = this.opts;
    const bytesPerSec = Math.ceil(shapeMbps * 1e6 / 8);
    this.set(`/SCHEDULER/${prefix}${name}`, {
      type: "STRICT",
      meter_type: "bytes",
      pir: `${bytesPerSec}`,
      pbs: "8192",
    });
    this.set(`/PORT_QOS_MAP/${port}`, {
      scheduler: `${prefix}${name}`,
    });
    for (const [queue, weight] of Object.entries(queueWeights)) {
      assert(Number.isInteger(weight) && weight >= 1 && weight <= 100);
      this.set(`/SCHEDULER/${prefix}${name}q${queue}`, {
        type,
        weight: type === "STRICT" ? undefined : `${weight}`,
      });
      this.set(`/QUEUE/${port}|${queue}`, {
        scheduler: `${prefix}${name}q${queue}`,
      });
    }
  }

  /** Write to output. */
  public output(): Promise<void> {
    const patch: Operation[] = [];

    for (const [path, value] of this.objects) {
      switch (this.opts.op) {
        case "add":
        case "replace": {
          patch.push({ op: "add", path, value });
          break;
        }
        case "remove":
        case "drop": {
          patch.push({ op: "remove", path });
          break;
        }
      }
    }

    for (const table of this.tables) {
      switch (this.opts.op) {
        case "add": {
          patch.unshift({ op: "add", path: `/${table}`, value: {} });
          break;
        }
        case "drop": {
          patch.push({ op: "remove", path: `/${table}` });
          break;
        }
      }
    }

    switch (this.opts.format) {
      case "patch": {
        return file_io.write("-", `${stringify(patch)}\n`);
      }
      case "pretty": {
        return file_io.write("-.json", patch);
      }
      case "shell": {
        return file_io.write("-.sh", `echo ${shlex.quote(stringify(patch))} | sudo config apply /dev/stdin\n`);
      }
    }
  }
}
