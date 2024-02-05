import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";

export function Yargs(): Argv {
  return yargs(hideBin(process.argv))
    .strict()
    .version(false)
    .showHelpOnFail(false)
    .wrap(yargs([]).terminalWidth());
}
