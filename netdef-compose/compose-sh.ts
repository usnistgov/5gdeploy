import path from "node:path";

import * as shlex from "shlex";
import assert from "tiny-invariant";

import * as compose from "../compose/mod.js";
import { trafficGenerators } from "../trafficgen/pduperf-tg.js";
import type { ComposeFile } from "../types/mod.js";
import { scriptHead as baseScriptHead } from "../util/mod.js";

const trafficgenScripts = ["linkstat", "list-pdu", "nmap", "nfd"];
const pduperfSubcommands = Object.keys(trafficGenerators);
pduperfSubcommands.sort((a, b) => a.localeCompare(b));

const scriptUsage = `Usage:
  ./compose.sh up
    Start the scenario.
  ./compose.sh down
    Stop the scenario.
  $(./compose.sh at CT) CMD
    Run Docker command CMD on the host machine of container CT.
  ./compose.sh upload
    Upload Compose context and Docker images to secondary hosts.
  ./compose.sh create
    Create scenario containers to prepare for traffic capture.
  ./compose.sh stop
    Stop and delete the containers, but keep the networks.
  ./compose.sh ps
    View containers on each host machine.
  ./compose.sh web
    View access instructions for web applications.
  ./compose.sh phoenix-register
    Register Open5GCore UEs.
  ./compose.sh linkstat
    Gather netif counters.

The following are available after UE registration and PDU session establishment:
  ./compose.sh list-pdu
    List PDU sessions.
  ./compose.sh nmap
    Run nmap ping scans from Data Network to UEs.
  ./compose.sh nfd --dnn=DNN
    Deploy NDN Forwarding Daemon (NFD) between Data Network and UEs.
  ./compose.sh ${pduperfSubcommands.join("|")} FLAGS
    Prepare traffic generators.
`;

const codebaseRoot = path.join(import.meta.dirname, "..");

const scriptHead = [
  "#!/bin/bash",
  ...baseScriptHead,
  "cd \"$(dirname \"${BASH_SOURCE[0]}\")\"", // eslint-disable-line no-template-curly-in-string
  "COMPOSE_CTX=$PWD",
  "ACT=${1:-}", // eslint-disable-line no-template-curly-in-string
  "[[ -z $ACT ]] || shift",
];

const scriptTail = [
  "elif [[ $ACT == web ]]; then",
  "  msg Prometheus is at $(yq '.services.prometheus.annotations[\"5gdeploy.ip_meas\"]' compose.yml):9090",
  "  msg Grafana is at $(yq '.services.grafana.annotations[\"5gdeploy.ip_meas\"]' compose.yml):3000 , login with admin/grafana",
  "  msg free5GC WebUI is at $(yq '.services.webui.annotations[\"5gdeploy.ip_mgmt\"]' compose.yml):5000 , login with admin/free5gc",
  "  msg Setup SSH port forwarding to access these services in a browser",
  "  msg \"'null'\" means the relevant service has been disabled",
  "elif [[ $ACT == phoenix-register ]]; then",
  `  cd ${codebaseRoot}`,
  "  for UECT in $(docker ps --format='{{.Names}}' | grep '^ue'); do",
  "    msg Invoking Open5GCore UE registration and PDU session establishment in $UECT",
  "    corepack pnpm -s phoenix-rpc --host=$UECT ue-register --dnn='*'",
  "  done",
  `elif ${trafficgenScripts.map((tg) => `[[ $ACT == ${tg} ]]`).join(" || ")}; then`,
  `  $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/trafficgen/$ACT.ts --dir=$COMPOSE_CTX "$@"`,
  `elif ${pduperfSubcommands.map((tg) => `[[ $ACT == ${tg} ]]`).join(" || ")}; then`,
  `  $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/trafficgen/pduperf.ts --mode=$ACT --dir=$COMPOSE_CTX "$@"`,
  "else",
  `  echo ${shlex.quote(scriptUsage)}`,
  "  exit 1",
  "fi",
];

const scriptActions: ReadonlyArray<[act: string, cmd: string, listServiceNames: boolean, msg1: string, msg2: string]> = [
  ["create", "compose create --remove-orphans", true, "Creating scenario containers", "Scenario containers have been created, ready for traffic capture"],
  ["up", "compose up -d --remove-orphans", true, "Starting the scenario", "Scenario has started"],
  ["ps", "ps -a", false, "Checking containers", "If any container is 'Exited' with non-zero code, please investigate why it failed"],
  ["down", "compose down --remove-orphans", false, "Stopping the scenario", "Scenario has stopped"],
  ["stop", "compose rm -f -s", false, "Stopping scenario containers", "Scenario containers have been deleted"],
];

/** Generate compose.sh script. */
export function* makeScript(c: ComposeFile): Iterable<string> {
  const hostServices = compose.classifyByHost(c);
  assert(hostServices.length > 0);

  yield* scriptHead;

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

  for (const [act, cmd, listServiceNames, msg1, msg2] of scriptActions) {
    yield `elif [[ $ACT == ${act} ]]; then`;
    for (const { hostDesc, dockerH, names } of hostServices) {
      yield `  msg ${shlex.quote(`${msg1} on ${hostDesc}`)}`;
      yield `  ${dockerH} ${cmd}${listServiceNames ? ` ${names.join(" ")}` : ""}`;
    }
    yield `  msg ${shlex.quote(msg2)}`;
  }

  yield* scriptTail;
}
