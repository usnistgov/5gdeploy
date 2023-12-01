#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

msg() {
  echo -ne "\e[35m[5gdeploy-scenario] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

die() {
  msg "$*"
  exit 1
}

for CMD in corepack docker jq; do
  if ! command -v $CMD >/dev/null; then
    die Missing required command $CMD
  fi
done

if ! docker version &>/dev/null; then
  die Unable to access Docker, check docker group membership
fi

if ! jq -e '.name == "@usnistgov/5gdeploy"' ../5gdeploy/package.json &>/dev/null; then
  die Missing 5gdeploy repository checkout
fi

msg Installing 5gdeploy
env -C ../5gdeploy corepack pnpm install
bash ../5gdeploy/types/build-schema.sh
bash ../5gdeploy/free5gc-config/download.sh

msg Building Docker images
for IMG in bridge dn free5gc-upf ns3http phoenix ueransim; do
  bash ../5gdeploy/docker/build.sh $IMG
done

msg Installing 5gdeploy-scenario
corepack pnpm install
corepack pnpm link ../5gdeploy

msg 5gdeploy-scenario is ready
