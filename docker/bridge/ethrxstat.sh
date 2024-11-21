#!/bin/ash
set -euo pipefail
NETIF=$1

ETHTOOL=ethtool
if [[ $NETIF == *:* ]]; then
  CT=${NETIF%:*}
  NETIF=${NETIF#*:}
  ETHTOOL="$(ctns.sh $CT) ethtool"
fi

SLEEP=${2:-0}
if [[ $SLEEP -eq 0 ]]; then
  $ETHTOOL -S $NETIF | grep -E ' rx-?[0-9]+[._]packets' | sort -V
  exit
fi

$ETHTOOL -S $NETIF | grep -E ' rx-?[0-9]+[._]packets' | sort -V >/tmp/$$-ethstat0.tsv
sleep $SLEEP
$ETHTOOL -S $NETIF | grep -E ' rx-?[0-9]+[._]packets' | sort -V >/tmp/$$-ethstat1.tsv
paste /tmp/$$-ethstat0.tsv /tmp/$$-ethstat1.tsv | awk '{ print $1, $4-$2 }' | column -t -N var,diff
rm -f /tmp/$$-ethstat0.tsv /tmp/$$-ethstat1.tsv
