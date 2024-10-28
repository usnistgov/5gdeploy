#!/bin/bash
set -euo pipefail

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

if ! [[ -d /sys/module/gtp5g ]]; then
  msg Decompressing gtp5g kernel module
  cd /
  unzip -n gtp5g.zip
  msg Loading gtp5g kernel module
  cd /gtp5g-*/
  make -j$(nproc)
  make install
fi

msg gtp5g kernel module $(cat /sys/module/gtp5g/version) is loaded, exiting
