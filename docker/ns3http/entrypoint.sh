#!/bin/bash
set -euo pipefail

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

INDEX=$1  # index number
FINDIF=$2 # ifname or IPv4 address or IPv4 subnet in CIDR format
shift 2

if [[ $FINDIF == *.*.*.* ]]; then
  msg Waiting for a network interface in $FINDIF to appear
  HOSTIF=''
  while [[ -z $HOSTIF ]]; do
    sleep 1
    HOSTIF=$(ip -j addr show to $FINDIF | jq -r '.[].ifname')
  done
  msg Found network interface $HOSTIF
else
  HOSTIF=$FINDIF
  msg Waiting for $HOSTIF to appear
  pipework --wait -i $HOSTIF
  sleep 1
fi

HOSTIP=$(ip -j addr show $HOSTIF | jq -r '.[].addr_info[] | select(.family=="inet") | .local')
TAPIF=ns3tap$INDEX
TAPIP=172.21.$INDEX.1
APPIP=172.21.$INDEX.2

msg Configuring full cone NAT
# https://www.joewein.net/info/sw-iptables-full-cone-nat.htm
iptables -t nat -I POSTROUTING -o $HOSTIF -j SNAT --to-source $HOSTIP
iptables -t nat -I PREROUTING -i $HOSTIF -j DNAT --to-destination $APPIP
TABLE=$(ip -j rule list from $HOSTIP | jq -r '.[].table')
if [[ -n $TABLE ]]; then
  ip rule add from $APPIP table $TABLE
fi

msg Starting ns-3 3GPP HTTP application
exec ns3http --tap-if=$TAPIF --tap-ip=$TAPIP --tap-mask=255.255.255.0 --app-ip=$APPIP "$@"
