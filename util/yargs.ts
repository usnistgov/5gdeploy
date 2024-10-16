import * as shlex from "shlex";
import assert from "tiny-invariant";
import type { LessThan, NonNegativeInteger, PartialOnUndefinedDeep, ReadonlyDeep, Simplify, Subtract } from "type-fest";
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

export type YargsInfer<T extends YargsOptions> = Simplify<PartialOnUndefinedDeep<ReadonlyDeep<InferredOptionTypes<T>>>>;

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

/**
 * Split vertical-bar separated flag input.
 * @param name - Flag name without leading "--".
 * @param line - Flag value, separated by either " | " or "|".
 * @param min - Minimum token quantity.
 * @param max - Maximum token quantity.
 */
export function splitVbar<Min extends number, Max extends number>(
    name: string,
    line: string,
    min: NonNegativeInteger<Min>,
    max: NonNegativeInteger<Max>,
): splitVbar.Result<Min, Max> {
  const tokens = line.split(/\s\|\s/.test(line) ? /\s+\|\s+/ : /\s*\|\s*/);
  assert(tokens.length >= min && tokens.length <= max,
    `bad ${joinVbar(name, tokens)} (expecting ${min}~${max} parts)`);
  return tokens as any;
}
export namespace splitVbar {
  export type Result<Min extends number, Max extends number> =
    LessThan<Min, Max> extends true ? [...Result<Min, Subtract<Max, 1>>, string | undefined] :
    LessThan<Min, 1> extends true ? [] : [...Result<Subtract<Min, 1>, Subtract<Max, 1>>, string];
}

export function joinVbar(name: string, tokens: readonly string[]): string {
  return `--${name}=${shlex.quote(tokens.join(" | "))}`;
}
