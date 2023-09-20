#!/bin/ash
set -euo pipefail
BRIDGES=$1
PEERS=$2

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
for BR in $(echo $BRIDGES | tr ',' '\n'); do
  I=$((I + 1))
  if ! netif_exists br-$BR; then
    msg Waiting for br-$BR network interface to appear
    while ! netif_exists br-$BR; do
      sleep 1
    done
  fi

  J=0
  for PEER in $(echo $PEERS | tr ',' '\n'); do
    J=$((J + 1))
    if is_own_ip $PEER; then
      SELF=$J
    fi
  done

  if [[ $J -ge 2 ]]; then
    echo 1 >/sys/class/net/br-$BR/bridge/stp_state
  fi

  J=0
  for PEER in $(echo $PEERS | tr ',' '\n'); do
    J=$((J + 1))
    NETIF=vx-$BR-$J
    ip link del $NETIF 2>/dev/null || true
    if [[ $J -eq $SELF ]]; then
      continue
    fi
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
  I=0
  for BR in $(echo $BRIDGES | tr ',' '\n'); do
    I=$((I + 1))
    J=0
    for PEER in $(echo $PEERS | tr ',' '\n'); do
      J=$((J + 1))
      NETIF=vx-$BR-$J
      ip link del $NETIF 2>/dev/null || true
    done
  done
}
trap cleanup SIGTERM

msg Idling
tail -f &
wait $!
