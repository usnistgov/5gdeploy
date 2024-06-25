import { execa } from "execa";
import { type AnyIterable, collect } from "streaming-iterables";

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

/**
 * Execute a bash script or write the commands to an output file.
 * @param args - Filename or result of {@link cmdOptions}.
 * @param lines - Script command lines.
 */
export async function cmdOutput(args: string | YargsInfer<typeof cmdOptions>, lines: AnyIterable<string>): Promise<void> {
  const script = [
    "#!/bin/bash",
    ...scriptHead,
    ...await collect(lines),
  ];

  const filename = typeof args === "string" ? args : args.cmdout;
  if (filename) {
    await file_io.write(filename, script);
  } else {
    const result = await execa("bash", ["-c", script.join("\n")], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      reject: false,
    });
    process.exitCode = result.exitCode;
  }
}
