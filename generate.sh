#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
D=$1
shift

msg() {
  echo -ne "\e[35m[5gdeploy-scenario] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

die() {
  msg "$*"
  exit 1
}

if ! [[ -f $D/scenario.ts ]]; then
  die Scenario script $D/scenario.ts does not exist
fi

OUT=../compose/$D
msg Output folder is $OUT

if [[ -f $OUT/compose.yml ]]; then
  msg Deleting existing scenario
  docker compose --project-directory=$OUT down --remove-orphans
  rm -rf $OUT/*
fi

msg Generating scenario via netdef
mkdir -p $OUT
SARGS=()
while [[ $1 == +* ]]; do
  SARGS+=("${1/#+/--}")
  shift
done
./node_modules/.bin/tsx $D/scenario.ts "${SARGS[@]}" | jq -S >$OUT/netdef.json
env -C ../5gdeploy corepack pnpm -s netdef-compose --netdef=$OUT/netdef.json --out=$OUT $*

msg Scenario folder is ready, to start the scenario:
msg ' ' docker compose --project-directory=$(readlink -f $OUT) up -d
