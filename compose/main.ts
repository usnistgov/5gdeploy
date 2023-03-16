import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import fsWalk from "@nodelib/fs.walk";
import stringify from "json-stable-stringify";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as compose from "./compose.js";
import * as ipmap from "./ipmap.js";

const fsWalkPromise = promisify(fsWalk.walk);

const args = await yargs(hideBin(process.argv))
  .option("cfg", {
    demandOption: true,
    desc: "Open5GCore cfg directory",
    type: "string",
  })
  .option("out", {
    demandOption: true,
    desc: "Compose output directory",
    type: "string",
  })
  .parseAsync();
await fs.mkdir(args.out, { recursive: true });

const ipmapRecords = ipmap.parse(await fs.readFile(path.join(args.cfg, "ip-map"), "utf8"));
const composeFile = compose.convert(ipmapRecords);
await fs.writeFile(path.join(args.out, "compose.yml"), stringify(composeFile, { space: 2 }));

const outCfg = path.join(args.out, "cfg");
try {
  await fs.unlink(outCfg);
} catch {}
try {
  await fs.symlink(args.cfg, outCfg);
} catch {}

const outSql = path.join(args.out, "sql");
await fs.mkdir(outSql, { recursive: true });
for (const entry of await fsWalkPromise(outSql)) {
  await fs.unlink(entry.path);
}
for (const entry of await fsWalkPromise(path.join(args.cfg, "sql"), {
  entryFilter: ({ name }) => name.endsWith(".sql"),
})) {
  await fs.copyFile(entry.path, path.join(outSql, entry.name));
}
