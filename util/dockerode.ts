import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import Dockerode from "dockerode";
import { collect } from "streaming-iterables";

/**
 * Create handle to a Docker container.
 * @param ct - Container name.
 * @param host - Docker host name, empty means localhost.
 * @returns Dockerode container handle.
 */
export function getContainer(ct: string, host?: string): Dockerode.Container {
  const opts: Dockerode.DockerOptions = {};
  if (host) {
    opts.protocol = "ssh";
    opts.host = host;
  }
  return new Dockerode(opts).getContainer(ct);
}

/**
 * Execute a command in a Docker container and wait for its completion.
 * @param ct - Dockerode container handle.
 * @param cmd - Command binary and arguments.
 * @returns Gathered stdout and stderr.
 */
export async function execCommand(ct: Dockerode.Container, cmd: readonly string[]): Promise<execCommand.Result> {
  const exec = await ct.exec({
    Cmd: [...cmd],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({});

  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  ct.modem.demuxStream(stream, stdoutStream, stderrStream);

  const [stdoutChunks, stderrChunks, exitCode] = await Promise.all([
    collect(stdoutStream),
    collect(stderrStream),
    (async () => {
      let status: Dockerode.ExecInspectInfo;
      while ((status = await exec.inspect()).Running) {
        await delay(500);
      }
      stdoutStream.end();
      stderrStream.end();
      return status.ExitCode!;
    })(),
  ]);
  return {
    exitCode,
    stdoutChunks,
    get stdout() {
      return Buffer.concat(stdoutChunks).toString("utf8");
    },
    stderrChunks,
    get stderr() {
      return Buffer.concat(stderrChunks).toString("utf8");
    },
  };
}
export namespace execCommand {
  export interface Result {
    exitCode: number;
    stdoutChunks: Buffer[];
    stdout: string;
    stderrChunks: Buffer[];
    stderr: string;
  }
}
