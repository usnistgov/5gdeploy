import { type ReadonlyDeep } from "type-fest";
import yargs, { type Argv, type InferredOptionTypes, type Options } from "yargs";
import { hideBin } from "yargs/helpers";

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

export function YargsDefaults<T extends YargsOptions>(opts: T) {
  return yargs([]).option(opts).parseSync();
}
