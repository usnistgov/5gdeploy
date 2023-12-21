#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

die() {
  msg "$*"
  exit 1
}

for CMD in corepack docker jq yq; do
  if ! command -v $CMD >/dev/null; then
    die Missing required command $CMD
  fi
done

if ! docker version &>/dev/null; then
  die Unable to access Docker, check docker group membership
fi

msg Installing 5gdeploy
corepack pnpm install
bash ./types/build-schema.sh
bash ./free5gc/download.sh

for IMG in bridge dn free5gc-upf ns3http phoenix ueransim; do
  msg Building Docker image $IMG
  bash ./docker/build.sh $IMG
done

msg 5gdeploy is installed
