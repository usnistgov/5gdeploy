#!/bin/bash
set -euo pipefail
CT=$(hostname -s)
phoenixdir=/opt/phoenix
cd $cfgdir

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

$phoenixdir/tools/ph_init/ip-export.sh < ip-map > /run/phoenix-ip-export.sh
. /run/phoenix-ip-export.sh

ip route del default || true
if [[ $CT == hostnat ]]; then
  HOSTNAT_MGMT_GW=$(echo $HOSTNAT_MGMT_IP | sed 's/\.[0-9]*$/.1/')
  ip route add default via $HOSTNAT_MGMT_GW
  iptables -t nat -I POSTROUTING -o mgmt -j SNAT --to $HOSTNAT_MGMT_IP
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

ip addr
ip route

if [[ -f env.sh ]]; then
  . env.sh
fi
if [[ -f $CT.sh ]]; then
  . $CT.sh
fi

if [[ -f $CT.json ]]; then
  exec $phoenixdir/dist/phoenix.sh -j $cfgdir/$CT.json -p $phoenixdir/dist/lib
else
  exec tail -f
fi
