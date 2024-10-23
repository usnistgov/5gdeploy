import path from "node:path";

import { execa } from "execa";
import * as shlex from "shlex";
import { type AnyIterable, collect } from "streaming-iterables";

import * as file_io from "./file-io.js";
import type { YargsInfer, YargsOptions } from "./yargs.js";

export const codebaseRoot = path.join(import.meta.dirname, "..");

/** Shell script heading with strict setting only. */
export const scriptHeadStrict = [
  "set -euo pipefail",
];

/** Shell script heading with common shell functions. */
export const scriptHead = [
  ...scriptHeadStrict,
  "msg() { echo -ne \"\\e[35m[5gdeploy] \\e[94m\"; echo -n \"$*\"; echo -e \"\\e[0m\"; }",
  "die() { msg \"$*\"; exit 1; }",
  "with_retry() { while ! \"$@\"; do sleep 0.2; done }",
];

/** bash tsrun() function. */
export const scriptHeadTsrun = [
  `tsrun() { local CMD=$1; shift; $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/$CMD "$@"; }`,
];

/**
 * Shell script cleanup trap.
 *
 * @remarks
 * This should be placed near the top of the script.
 *
 * To add a cleanup action:
 * ```bash
 * CLEANUPS=$CLEANUPS"; cleanup command"
 * ```
 *
 * The service process should be launched as:
 * ```bash
 * service-binary &
 * wait $!
 * ```
 */
export function* scriptCleanup({
  shell = "bash",
  signals = ["EXIT", "SIGTERM"],
}: scriptCleanup.Options = {}): Iterable<string> {
  yield "CLEANUPS='set -euo pipefail'";
  yield `cleanup() { msg Performing cleanup; ${shell} -c "$CLEANUPS"; trap - ${shlex.join(signals as string[])}; }`;
  yield `trap cleanup ${shlex.join(signals as string[])}`;
}
export namespace scriptCleanup {
  export interface Options {
    shell?: string;
    signals?: readonly string[];
  }
}

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
