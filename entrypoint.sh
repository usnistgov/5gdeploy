#!/bin/bash
set -euo pipefail
CT=$(hostname -s)
cd $cfgdir

msg() {
  echo -ne "\e[35m[phoenix-deploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

msg \$phoenixdir is $phoenixdir
msg \$cfgdir is $cfgdir

msg renaming network interfaces
ip -j addr | jq -r '.[] | [.ifname, (.addr_info[] | select(.family=="inet") | .local)] | @tsv' | while read IFNAME IP; do
  if [[ -z $IP ]] || [[ $IFNAME == lo ]]; then
    continue
  fi
  IFNEWNAME=$(awk -vCT=$CT -vIP=$IP '$1==CT && $3==IP { print $2 }' ip-map)
  if [[ -n $IFNEWNAME ]]; then
    msg renaming "$IFNAME" to "$IFNEWNAME"
    ip link set dev "$IFNAME" down
    ip link set dev "$IFNAME" name "$IFNEWNAME"
    ip link set dev "$IFNEWNAME" up
  fi
done

msg creating dummy network interfaces for /32 allocations
awk -vCT=$CT '
  $0~!"^#" && NF==4 && $1==CT && $4==32 {
    cmd = "ip link add " $2 " type dummy && ip link set " $2 " up && ip addr add " $3 "/" $4 " dev " $2
    print "# " cmd
    system(cmd)
  }
' ip-map

msg processing ip-export
$phoenixdir/tools/ph_init/ip-export.sh < ip-map > /run/phoenix-ip-export.sh
. /run/phoenix-ip-export.sh

if [[ $CT == hostnat ]]; then
  HOSTNAT_MGMT_GW=$(echo $HOSTNAT_MGMT_IP | sed 's/\.[0-9]*$/.1/')
  msg setting IPv4 default route to $HOSTNAT_MGMT_GW and enabling SNAT to $HOSTNAT_MGMT_IP
  ip route replace default via $HOSTNAT_MGMT_GW
  iptables -t nat -I POSTROUTING -o mgmt -j SNAT --to $HOSTNAT_MGMT_IP
else
  msg deleting IPv4 default route if exists
  ip route del default || true
fi

if [[ -f other ]]; then
  msg processing \$cfgdir/other script
  awk -vCT=$CT '
    $2!=CT { next }
    { cmd = "" }
    $1=="r" { cmd = "ip route add " $3 " via " $4 }
    $1=="c" && $3!="sysctl" {
      cmd = ""
      for (i=3; i<=NF; ++i) {
        cmd = cmd $i " "
      }
    }
    cmd!="" {
      print "# " cmd
      system(cmd)
    }
  ' other
fi

msg ip addr listing:
ip addr
msg ip route listing:
ip route

if [[ -f env.sh ]]; then
  msg processing env.sh
  . env.sh
fi
if [[ -f $CT.sh ]]; then
  msg processing $CT.sh
  . $CT.sh
fi

if [[ -f $CT.json ]]; then
  msg starting phoenix process with $CT.json
  exec $phoenixdir/dist/phoenix.sh -j $cfgdir/$CT.json -p $phoenixdir/dist/lib
else
  msg starting idling process
  exec tail -f
fi
