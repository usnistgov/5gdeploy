#!/bin/bash
set -euo pipefail

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

msg Editing etc/init.conf
sed -i "/node-id/ s|.*|upf node-id ip4 $IF_2_IP|" etc/init.conf
cat etc/init.conf

msg Flushing IP addresses
for NETIF in n3-1 n4-2 n6-3 n9-4; do
  ip addr flush dev $NETIF
done

msg Invoking run.sh
/openair-upf/run.sh &

while true; do
  sleep 30
  msg Checking PFCP associations
  ASSOC_COUNT=$(bin/vppctl show upf association | tee /tmp/vpp-upf-assoc.txt | wc -l)
  msg Found $((ASSOC_COUNT / 3)) PFCP assocations
  cat /tmp/vpp-upf-assoc.txt
  if [[ $ASSOC_COUNT -eq 0 ]]; then
    msg Restarting VPP
    bin/vppctl restart
    sleep 10
    msg Reloading UPF configuration
    bin/vppctl exec etc/init.conf
  fi
done
