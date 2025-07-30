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

# Parse command line arguments for optional version tags
declare -A TAGS=(
  [bridge]=""
  [eupf]=""
  [free5gc]=""
  [free5gc-webclient]=""
  [gnbsim]=""
  [gtp5g]=""
  [oai-fed]=""
  [oai-nwdaf]=""
  [open5gs]=""
  [packetrusher]=""
  [srsran5g]=""
  [ueransim]=""
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pipework-version)
      TAGS[bridge]="$2"
      msg "Argument pipework-version = ${TAGS[bridge]}"
      shift 2
      ;;
    --eupf-version)
      TAGS[eupf]="$2"
      msg "Argument eupf-version = ${TAGS[eupf]}"
      shift 2
      ;;
    --free5gc-version)
      TAGS[free5gc]="$2"
      msg "Argument free5gc-version = ${TAGS[free5gc]}"
      shift 2
      ;;
    --free5gc-webconsole-version)
      TAGS[free5gc-webclient]="$2"
      msg "Argument free5gc-webconsole-version = ${TAGS[free5gc-webclient]}"
      shift 2
      ;;
    --gnbsim-version)
      TAGS[gnbsim]="$2"
      msg "Argument gnbsim-version = ${TAGS[gnbsim]}"
      shift 2
      ;;
    --gtp5g-version)
      TAGS[gtp5g]="$2"
      msg "Argument gtp5g-version = ${TAGS[gtp5g]}"
      shift 2
      ;;
    --oai-fed-version)
      TAGS[oai-fed]="$2"
      msg "Argument oai-fed-version = ${TAGS[oai-fed]}"
      shift 2
      ;;
    --oai-nwdaf-version)
      TAGS[oai-nwdaf]="$2"
      msg "Argument oai-nwdaf-version = ${TAGS[oai-nwdaf]}"
      shift 2
      ;;
    --open5gs-version)
      TAGS[open5gs]="$2"
      msg "Argument open5gs-version = ${TAGS[open5gs]}"
      shift 2
      ;;
    --packetrusher-version)
      TAGS[packetrusher]="$2"
      msg "Argument packetrusher-version = ${TAGS[packetrusher]}"
      shift 2
      ;;
    --sockperf-version)
      TAGS[sockperf]="$2"
      msg "Argument sockperf-version = ${TAGS[sockperf]}"
      shift 2
      ;;
    --srsran5g-version)
      TAGS[srsran5g]="$2"
      msg "Argument srsran5g-version = ${TAGS[srsran5g]}"
      shift 2
      ;;
    --ueransim-version)
      TAGS[ueransim]="$2"
      msg "Argument ueransim-version = ${TAGS[ueransim]}"
      shift 2
      ;;
    --dpdk-version)
      TAGS[virt]="$2"
      msg "Argument dpdk-version = ${TAGS[virt]}"
      shift 2
      ;;
    *)
      die "Unknown argument: \"$1\""
      shift
      ;;
  esac
done

if ! docker version &>/dev/null; then
  die Unable to access Docker, check docker group membership
fi

msg Installing 5gdeploy
corepack pnpm install
bash ./types/build-schema.sh
bash ./eupf/download.sh "${TAGS[eupf]}"
bash ./free5gc/download.sh "${TAGS[free5gc]}" "${TAGS[free5gc-webclient]}"
bash ./oai/download.sh "${TAGS[oai-fed]}" "${TAGS[oai-nwdaf]}"
bash ./open5gs/download.sh "${TAGS[open5gs]}"

for IMG in bridge dn eupf free5gc-webclient gnbsim gtp5g iperf2 ns3http open5gs packetrusher sockperf srsran5g ueransim virt; do
  TAG=${TAGS[$IMG]:-}
  msg "Building Docker image $IMG"
  ./docker/build.sh $IMG $TAG
done

msg 5gdeploy is installed
