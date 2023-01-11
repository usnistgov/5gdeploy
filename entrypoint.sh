#!/bin/bash
set -euo pipefail
CFGDIR=/opt/phoenix/cfg/current
CT=$(hostname -s)
cd $CFGDIR

ip -j addr | jq -r '.[] | [.ifname, (.addr_info[] | select(.family=="inet") | .local)] | @tsv' | while read IFNAME IP; do
  if [[ -z $IP ]] || [[ $IFNAME == lo ]]; then
    continue
  fi
  IFNEWNAME=$(awk -vCT=$CT -vIP=$IP '$1==CT && $3==IP { print $2 }' ip-map)
  if [[ -n $IFNEWNAME ]]; then
    ip link set dev "$IFNAME" down
    ip link set dev "$IFNAME" name "$IFNEWNAME"
    ip link set dev "$IFNEWNAME" up
  fi
done

ip route del default || true
if [[ $CT == hostnat ]]; then
  IP=$(ip -j addr show mgmt | jq -r '.[] | .addr_info[] | select(.family=="inet") | .local')
  GW=$(echo $IP | sed 's/\.[0-9]*$/.1/')
  ip route add default via $GW
  iptables -t nat -I POSTROUTING -o mgmt -j SNAT --to $IP
fi

if [[ -f other ]]; then
  awk -vCT=$CT '
    $2!=CT { next }
    $1=="r" { system("ip route add " $3 " via " $4)  }
    $1=="c" && $3!="sysctl" {
      cmd = ""
      for (i=3; i<=NF; ++i) {
        cmd = cmd $i " "
      }
      system(cmd)
    }
  ' other
fi

phoenixdir=/opt/phoenix
cfgdir=$CFGDIR
if [[ -f env.sh ]]; then
  . env.sh
fi
if [[ -f $CT.sh ]]; then
  . $CT.sh
fi

if [[ -f $CT.json ]]; then
  exec /opt/phoenix/dist/phoenix.sh -p /opt/phoenix/dist/lib -j $CFGDIR/$CT.json
else
  exec tail -f
fi
