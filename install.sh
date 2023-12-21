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

if ! [[ -x ../5gdeploy/install.sh ]]; then
  die Missing 5gdeploy repository checkout
fi
../5gdeploy/install.sh

msg Installing 5gdeploy-scenario
corepack pnpm install
corepack pnpm link ../5gdeploy

msg 5gdeploy-scenario is ready
