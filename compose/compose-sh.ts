import path from "node:path";

import map from "obliterator/map.js";
import * as shlex from "shlex";
import type { SetOptional } from "type-fest";

import type { ComposeFile } from "../types/mod.js";
import { assert, codebaseRoot, scriptHead } from "../util/mod.js";
import { annotate } from "./compose.js";
import { classifyByHost } from "./place.js";

/** Generate compose.sh script. */
export function* makeComposeSh(
    c: ComposeFile,
    ...actions: readonly makeComposeSh.Action[]
): Iterable<string> {
  yield "#!/bin/bash";
  yield* scriptHead;
  yield `TSRUN="$(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}"`;
  yield "cd \"$(dirname \"${BASH_SOURCE[0]}\")\""; // eslint-disable-line no-template-curly-in-string
  yield "COMPOSE_CTX=$PWD";
  yield "ACT=${1:-}"; // eslint-disable-line no-template-curly-in-string
  yield "[[ -z $ACT ]] || shift";

  const hostServices = classifyByHost(c);
  assert(hostServices.length > 0);
  yield "if [[ $ACT == at ]]; then";
  yield "  case ${1:-} in"; // eslint-disable-line no-template-curly-in-string
  for (const { dockerH, names } of hostServices) {
    yield `    ${names.join("|")}) echo ${shlex.quote(dockerH)};;`;
  }
  yield "    *) die Container not found;;";
  yield "  esac";

  yield "elif [[ $ACT == upload ]]; then";
  yield `  $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/compose/upload.ts --dir=$COMPOSE_CTX`;
  yield `  ${path.join(import.meta.dirname, "../upload.sh")} $COMPOSE_CTX ${
    hostServices.map(({ host }) => host).join(" ")}`;

  for (const [act, cmd, upNames, msg1, msg2] of ctActions) {
    yield `elif [[ $ACT == ${act} ]]; then`;
    for (const { hostDesc, dockerH, services } of hostServices) {
      yield `  msg ${shlex.quote(`${msg1} on ${hostDesc}`)}`;
      yield `  ${dockerH} ${cmd}${
        upNames ? services.filter((s) => !annotate(s, "only_if_needed")).map((s) => ` ${s.container_name}`).join("") : ""
      }`;
    }
    yield `  msg ${shlex.quote(msg2)}`;
  }

  for (const action of actions) {
    yield `elif [[ $ACT == ${action.act} ]]; then`;
    yield* map(action.code(), (line) => `  ${line}`);
  }

  yield "else";
  yield `  echo ${shlex.quote(`Usage:\n${[...makeHelp([...baseHelp, ...actions])].join("\n")}`)}`;
  yield "  exit 1";
  yield "fi";
}
export namespace makeComposeSh {
  export interface Action {
    act: string;
    cmd?: string;
    desc: string | readonly string[];
    code: () => Iterable<string>;
  }
}

const baseHelp: ReadonlyArray<SetOptional<makeComposeSh.Action, "code">> = [{
  act: "up",
  desc: "Start the scenario.",
}, {
  act: "down",
  desc: "Stop the scenario.",
}, {
  act: "at",
  cmd: "$(./compose.sh at CT) CMD",
  desc: "Run Docker command CMD on the host machine of container CT.",
}, {
  act: "upload",
  desc: "Upload Compose context and Docker images to secondary hosts.",
}, {
  act: "create",
  desc: "Create scenario containers to prepare for traffic capture.",
}, {
  act: "stop",
  desc: "Stop and delete the containers, but keep the networks.",
}, {
  act: "ps",
  desc: "View containers on each host machine.",
}];

const ctActions: ReadonlyArray<[act: string, cmd: string, upNames: boolean, msg1: string, msg2: string]> = [
  ["create", "compose create --remove-orphans", true, "Creating scenario containers", "Scenario containers have been created, ready for traffic capture"],
  ["up", "compose up -d --remove-orphans", true, "Starting the scenario", "Scenario has started"],
  ["ps", "ps -a", false, "Checking containers", "If any container is 'Exited' with non-zero code, please investigate why it failed"],
  ["down", "compose down --remove-orphans", false, "Stopping the scenario", "Scenario has stopped"],
  ["stop", "compose rm -f -s", false, "Stopping scenario containers", "Scenario containers have been deleted"],
];

function* makeHelp(help: typeof baseHelp): Iterable<string> {
  for (const { act, cmd = act, desc } of help) {
    if (cmd.includes("./compose.sh")) {
      yield `  ${cmd}`;
    } else {
      yield `  ./compose.sh ${cmd}`;
    }
    if (typeof desc === "string") {
      yield `    ${desc}`;
    } else {
      yield* map(desc, (line) => `    ${line}`);
    }
  }
}
