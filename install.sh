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
bash ./oai/download.sh
bash ./open5gs/download.sh

for IMG in bridge dn free5gc-webclient gnbsim gtp5g iperf2 ns3http open5gs packetrusher phoenix sockperf srsran5g ueransim virt; do
  if [[ $IMG == phoenix ]] && [[ ${NOPHOENIX:-} -eq 1 ]]; then
    msg Skipping Docker image $IMG
    continue
  fi
  msg Building Docker image $IMG
  ./docker/build.sh $IMG
done

msg 5gdeploy is installed
