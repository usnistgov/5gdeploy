#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
D=$1
shift

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

die() {
  msg "$*"
  exit 1
}

if [[ $D == --help ]]; then
  msg "generate.sh USAGE"
  msg "./generate.sh SCENARIO-ID [+scenario-flags] [--netdef-compose-flags]"
  msg "  Generate Compose context from a scenario"
  msg "./generate.sh SCENARIO-ID --help"
  msg "  Obtain help information of a scenario"
  exit 0
fi

if ! [[ -f $D/scenario.ts ]]; then
  die Scenario script $D/scenario.ts does not exist
fi

if [[ ${1:-} == +help ]] || [[ ${1:-} == --help ]]; then
  msg Help information from $D/scenario.ts
  msg "(when using generate.sh, change '--' to '+' in these flags)"
  $(corepack pnpm bin)/tsx $D/scenario.ts --help
  msg ''
  msg Help information from netdef-compose
  msg "(when using generate.sh, write these flags after '+' flags)"
  corepack pnpm -s netdef-compose --help
  exit 0
fi

OUT=../../compose/$D
mkdir -p $OUT
OUT=$(readlink -f $OUT)

if [[ -f $OUT/compose.yml ]]; then
  msg Deleting existing scenario
  $OUT/compose.sh down || true
  rm -rf $OUT/*
fi

msg Generating scenario via netdef
SARGS=()
while [[ ${1:-} == +* ]]; do
  SARGS+=("${1/#+/--}")
  shift
done
$(corepack pnpm bin)/tsx $D/scenario.ts "${SARGS[@]}" >$OUT/netdef.json
corepack pnpm -s netdef-compose --netdef=$OUT/netdef.json --out=$OUT $*

msg Scenario folder is ready, to start the scenario:
msg ' ' $(readlink -f $OUT)/compose.sh up
