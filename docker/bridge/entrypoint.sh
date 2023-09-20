#!/bin/ash
set -euo pipefail
BRIDGES=$1
NETIFS=""

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

netif_exists() {
  ip link show $1 &>/dev/null
}

is_own_ip() {
  test $(ip -j route get $1 | jq -r '.[].prefsrc') == $1
}

I=0
for BRIDGE in $BRIDGES; do
  I=$((I + 1))
  set -- $(echo $BRIDGE | tr , '\n')
  BR=$1
  shift 2
  if ! netif_exists br-$BR; then
    msg Waiting for br-$BR network interface to appear
    while ! netif_exists br-$BR; do
      sleep 1
    done
  fi

  J=0
  for PEER in "$@"; do
    J=$((J + 1))
    if is_own_ip $PEER; then
      SELF=$J
    fi
  done

  J=0
  for PEER in "$@"; do
    J=$((J + 1))
    if [[ $J -eq $SELF ]] || ([[ $J -ne 1 ]] && [[ $SELF -ne 1 ]]); then
      continue
    fi
    NETIF=vx-$BR-$J
    NETIFS=$NETIFS' '$NETIF
    ip link del $NETIF 2>/dev/null || true
    if [[ $SELF -lt $J ]]; then
      VXI=$((1000000 * I + 1000 * SELF + J))
    else
      VXI=$((1000000 * I + 1000 * J + SELF))
    fi
    msg Connecting br-$BR to $PEER on $NETIF with VXLAN id $VXI
    ip link add $NETIF type vxlan id $VXI remote $PEER dstport 4789
    ip link set $NETIF up master br-$BR
  done
done

cleanup() {
  msg Deleting bridge netifs
  for NETIF in $NETIFS; do
    ip link del $NETIF 2>/dev/null || true
  done
}
trap cleanup SIGTERM

msg Idling
tail -f &
wait $!
