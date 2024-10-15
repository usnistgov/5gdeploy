import path from "node:path";

import * as compose from "../compose/mod.js";
import type { ComposeFile } from "../types/mod.js";
import { cmdOptions, cmdOutput, dockerode, file_io, Yargs } from "../util/mod.js";
import { virtDockerImage } from "../virt/context.js";

const args = Yargs()
  .option(cmdOptions)
  .option("dir", {
    demandOption: true,
    desc: "Compose context directory",
    type: "string",
  })
  .option("file", {
    default: "compose.yml",
    desc: "Compose filename",
    type: "string",
  })
  .parseSync();

const c = await file_io.readYAML(path.join(args.dir, args.file)) as ComposeFile;

const localImages = await dockerode.listImages(undefined);
const pullImages = new Set<string>();
const pushImagesByHost: Array<compose.classifyByHost.Result & { pushImages: Set<string> }> = [];

for (const hostServices of compose.classifyByHost(c).filter(({ host }) => !!host)) {
  const inVM = hostServices.services.some((s) => !!compose.annotate(s, "vmname") && s.image !== virtDockerImage);
  const remoteImages = await dockerode.listImages(inVM ? undefined : "5gdeploy.localhost/*", hostServices.host);
  const pushImages = new Set<string>();
  for (const { image } of hostServices.services) {
    const localID = localImages.get(image);
    const remoteID = remoteImages.get(image);
    switch (true) {
      case !(inVM || image.startsWith("5gdeploy.localhost/")):
      case remoteID === localID && !!localID:
      case !!remoteID && !localID: {
        break;
      }
      case !localID: {
        pullImages.add(image);
        // fallthrough
      }
      default: {
        pushImages.add(image);
      }
    }
  }
  pushImagesByHost.push({ ...hostServices, pushImages });
}

await cmdOutput(args, (async function*() {
  if (pullImages.size > 0) {
    yield "msg Pulling images on behalf of secondary hosts";
    for (const image of pullImages) {
      yield `docker pull ${image}`;
    }
  }

  for (const { dockerH, hostDesc, pushImages } of pushImagesByHost) {
    if (pushImages.size > 0) {
      const images = Array.from(pushImages).join(" ");
      yield `msg Uploading ${images} to ${hostDesc}`;
      yield `docker save ${images} | ${dockerH} load`;
    } else {
      yield `msg Docker images are up-to-date on ${hostDesc}`;
    }
  }
})());
