import { execa } from "execa";

import * as file_io from "./file-io.js";
import type { YargsInfer, YargsOptions } from "./yargs.js";

/** Shell script heading with common shell functions. */
export const scriptHead = [
  "set -euo pipefail",
  "msg() { echo -ne \"\\e[35m[5gdeploy] \\e[94m\"; echo -n \"$*\"; echo -e \"\\e[0m\"; }",
  "die() { msg \"$*\"; exit 1; }",
  "with_retry() { while ! \"$@\"; do sleep 0.2; done }",
];

export const cmdOptions = {
  cmdout: {
    desc: "save command line to file",
    type: "string",
  },
} as const satisfies YargsOptions;

export async function cmdOutput(args: YargsInfer<typeof cmdOptions>, lines: Iterable<string>): Promise<void> {
  const script = [
    "#!/bin/bash",
    ...scriptHead,
    ...lines,
  ].join("\n");

  if (args.cmdout) {
    await file_io.write(args.cmdout, script);
  } else {
    const result = await execa("bash", ["-c", script], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      reject: false,
    });
    process.exitCode = result.exitCode;
  }
}
