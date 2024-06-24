import path from "node:path";

import * as compose from "../compose/mod.js";
import type { ComposeFile } from "../types/mod.js";
import { cmdOptions, cmdOutput, dockerode, file_io, Yargs } from "../util/mod.js";

const args = Yargs()
  .option(cmdOptions)
  .option("dir", {
    demandOption: true,
    desc: "Compose context directory",
    type: "string",
  })
  .parseSync();

const c = await file_io.readYAML(path.join(args.dir, "compose.yml")) as ComposeFile;
const localImages = await dockerode.listImages("5gdeploy.localhost/*");
const cmds: string[] = [];

for (const hostServices of compose.classifyByHost(c).filter(({ host }) => !!host)) {
  const remoteImages = await dockerode.listImages("5gdeploy.localhost/*", hostServices.host);
  const pushImages = new Set<string>();
  for (const { image } of hostServices.services) {
    if (image.startsWith("5gdeploy.localhost/") && remoteImages.get(image) !== localImages.get(image)) {
      pushImages.add(image);
    }
  }

  if (pushImages.size > 0) {
    const images = Array.from(pushImages).join(" ");
    cmds.push(
      `msg Uploading ${images} to ${hostServices.hostDesc}`,
      `docker save ${images} | ${hostServices.dockerH} load`,
    );
  } else {
    cmds.push(`msg Docker images are up-to-date on ${hostServices.hostDesc}`);
  }
}

await cmdOutput(args, cmds);
