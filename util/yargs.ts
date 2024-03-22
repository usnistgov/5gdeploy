import type { ReadonlyDeep } from "type-fest";
import yargs, { type Argv, type InferredOptionTypes, type Options } from "yargs";
import { hideBin } from "yargs/helpers";

/** Construct yargs.Argv instance in current process. */
export function Yargs(): Argv {
  return yargs(hideBin(process.argv))
    .strict()
    .version(false)
    .showHelpOnFail(false)
    .wrap(yargs([]).terminalWidth());
}

export type YargsOpt = Options;

export type YargsOptions = Record<string, YargsOpt>;

export type YargsInfer<T extends YargsOptions> = ReadonlyDeep<InferredOptionTypes<T>>;

/** Infer argv from defaults in YargsOptions. */
export function YargsDefaults<T extends YargsOptions>(opts: T): YargsInfer<T> {
  return yargs([]).option(opts).parseSync() as any;
}

/** Define YargsOpt that accepts integer scalar in a range. */
export function YargsIntRange({
  default: dflt,
  desc,
  min = 1,
  max,
}: YargsIntRange.Options) {
  return {
    array: false,
    coerce(n: number): number {
      if (!Number.isSafeInteger(n) || n < min || n > max) {
        throw new RangeError(`${desc} must be integer between ${min} and ${max}`);
      }
      return n;
    },
    default: dflt,
    desc: `${desc} (${min}..${max})`,
    type: "number",
  } satisfies YargsOpt;
}
export namespace YargsIntRange {
  export interface Options extends Pick<YargsOpt, "default" | "desc"> {
    /**
     * Minimum value.
     * @defaultValue 1
     */
    min?: number;

    /** Maximum value. */
    max: number;
  }
}
