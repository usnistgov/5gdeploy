import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import Dockerode from "dockerode";
import { collect } from "streaming-iterables";

let privateKey: Buffer | undefined;

/**
 * Create handle to Docker Engine.
 * @param host - Docker host name (empty means localhost) or existing handle.
 * @returns Dockerode handle.
 */
export function open(host?: string | Dockerode): Dockerode {
  if (host instanceof Dockerode) {
    return host;
  }

  const opts: Dockerode.DockerOptions = {};
  if (host) {
    opts.protocol = "ssh";
    opts.sshOptions = {
      privateKey: (privateKey ??= fs.readFileSync(path.join(os.homedir(), ".ssh/id_ed25519"))),
    };
    const u = new URL(`ssh://${host}`);
    opts.username = u.username || os.userInfo().username;
    opts.host = u.hostname;
    opts.port = u.port || undefined;
  }
  return new Dockerode(opts);
}

/**
 * List Docker images.
 * @param pattern - Image reference glob pattern.
 * @param host - Docker host name (empty means localhost) or existing handle.
 * @returns Mapping from image name to ID.
 */
export async function listImages(pattern: string | undefined, host?: string | Dockerode): Promise<Map<string, string>> {
  const listOpts: Dockerode.ListImagesOptions = {};
  if (pattern) {
    listOpts.filters = { reference: [pattern] };
  }

  const m = new Map<string, string>();
  for (const image of await open(host).listImages(listOpts)) {
    for (const tag of image.RepoTags ?? []) {
      m.set(tag, image.Id);
      if (tag.endsWith(":latest")) {
        m.set(tag.slice(0, -7), image.Id);
      }
    }
  }
  return m;
}

/**
 * Create handle to a Docker container.
 * @param ct - Container name.
 * @param host - Docker host name (empty means localhost) or existing handle.
 * @returns Dockerode container handle.
 */
export function getContainer(ct: string, host?: string | Dockerode): Dockerode.Container {
  return open(host).getContainer(ct);
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
