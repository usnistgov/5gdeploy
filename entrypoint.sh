#!/bin/bash
set -euo pipefail
CFGDIR=/opt/phoenix/cfg/current
CT=$(hostname -s)

ip -j addr | jq -r '.[] | [.ifname, (.addr_info[] | select(.family=="inet") | .local)] | @tsv' | while read IFNAME IP; do
  if [[ -z $IP ]] || [[ $IFNAME == lo ]]; then
    continue
  fi
  IFNEWNAME=$(awk -vCT=$CT -vIP=$IP '$1==CT && $3==IP { print $2 }' $CFGDIR/ip-map)
  if [[ -n $IFNEWNAME ]]; then
    ip link set dev "$IFNAME" down
    ip link set dev "$IFNAME" name "$IFNEWNAME"
    ip link set dev "$IFNEWNAME" up
  fi
done

exec $CFGDIR/start.sh $CT 1
