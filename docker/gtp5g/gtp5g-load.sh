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

msg gtp5g kernel module $(cat /sys/module/gtp5g/version) is loaded

case "${GTP5G_DBG:-}" in
  [01234])
    msg Setting debug level
    echo $GTP5G_DBG | tee /proc/gtp5g/dbg
    ;;
  *) ;;
esac

case "${GTP5G_QOS:-}" in
  [01])
    msg Toggling QoS feature
    echo $GTP5G_QOS | tee /proc/gtp5g/qos
    ;;
  *) ;;
esac

case "${GTP5G_SEQ:-}" in
  [01])
    msg Toggling GTP-U sequence number feature
    echo $GTP5G_SEQ | tee /proc/gtp5g/seq
    ;;
  *) ;;
esac
