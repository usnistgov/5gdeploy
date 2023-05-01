#!/bin/bash
set -euo pipefail
CT=$1

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

gnb() {
  export GNB_NGA_IF_NAME=$(ip -j addr show to $GNB_NGA_IP_ADDRESS | jq -r '.[].ifname')
  export GNB_NGU_IF_NAME=$(ip -j addr show to $GNB_NGU_IP_ADDRESS | jq -r '.[].ifname')
  msg NGA netif is $GNB_NGA_IF_NAME
  msg NGU netif is $GNB_NGU_IF_NAME

  msg Starting 5G gNodeB
  exec /opt/oai-gnb/bin/entrypoint.sh /opt/oai-gnb/bin/nr-softmodem -O /opt/oai-gnb/etc/gnb.conf
}

nr_ue() {
  sleep 10
  msg Starting 5G UE
  exec /opt/oai-nr-ue/bin/entrypoint.sh /opt/oai-nr-ue/bin/nr-uesoftmodem -O /opt/oai-nr-ue/etc/nr-ue.conf
}

$CT
