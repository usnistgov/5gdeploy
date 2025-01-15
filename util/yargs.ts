import * as shlex from "shlex";
import assert from "tiny-invariant";
import type { Arrayable, Except, LessThan, NonNegativeInteger, PartialOnUndefinedDeep, ReadonlyDeep, Simplify, Subtract } from "type-fest";
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
export function YargsIntRange<O extends YargsIntRange.Options>(opts: O) {
  const { min = 1, max, desc = "", ...rest } = opts;
  return {
    ...rest,
    array: false,
    coerce(n: number): number {
      if (!Number.isSafeInteger(n) || n < min || n > max) {
        throw new RangeError(`${desc} must be integer between ${min} and ${max}`);
      }
      return n;
    },
    desc: `${desc} (${min}..${max})`,
    nargs: 1,
    type: "number",
  } satisfies YargsOpt;
}
export namespace YargsIntRange {
  export interface Options extends Exclude<YargsOpt, "array" | "coerce" | "nargs" | "type"> {
    /**
     * Minimum value.
     * @defaultValue 1
     */
    min?: number;

    /** Maximum value. */
    max: number;
  }
}

/** Partial YargsOpt that accepts non-negative floating pointer number. */
export const YargsFloatNonNegative = {
  array: false,
  coerce(n: number): number {
    if (!Number.isFinite(n) || n < 0) {
      throw new RangeError(`${this.desc} must be non-negative`);
    }
    return n;
  },
  nargs: 1,
  type: "number",
} satisfies YargsOpt;

/** Define YargsOpt that accepts string array with coerce function. */
export function YargsCoercedArray<T extends YargsCoercedArray.Options>(opts: T) {
  const { coerce, ...rest } = opts;
  return {
    default: [],
    ...rest,
    array: true,
    coerce(lines: readonly string[]): Array<ReturnType<T["coerce"]>> {
      return Array.from(lines, coerce);
    },
    nargs: 1,
    type: "string",
  } as const satisfies YargsOpt;
}
export namespace YargsCoercedArray {
  export interface Options extends Except<YargsOpt, "array" | "coerce" | "default" | "nargs" | "type"> {
    coerce: (line: string) => any;
    default?: Arrayable<string>;
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
  return splitVbar.untyped(name, line, min, max) as any;
}
export namespace splitVbar {
  export type Result<Min extends number, Max extends number> =
    LessThan<Min, Max> extends true ? [...Result<Min, Subtract<Max, 1>>, string | undefined] :
    LessThan<Min, 1> extends true ? [] : [...Result<Subtract<Min, 1>, Subtract<Max, 1>>, string];

  /** {@link splitVbar} returning array type, supports infinite maximum. */
  export function untyped(name: string, line: string, min = 0, max = Number.MAX_SAFE_INTEGER): string[] {
    const tokens = line.split(/\s\|\s/.test(line) ? /\s+\|\s+/ : /\s*\|\s*/);
    assert(tokens.length >= min && tokens.length <= max,
      `bad ${joinVbar(name, tokens)} (expecting ${min}~${max} parts)`);
    return tokens;
  }
}

/** Join vertical-bar separated flag input. */
export function joinVbar(name: string, tokens: readonly string[]): string {
  return `--${name}=${shlex.quote(tokens.join(" | "))}`;
}
