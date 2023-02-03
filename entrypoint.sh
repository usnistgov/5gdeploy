#!/bin/bash
set -euo pipefail
CT=$(hostname -s)

msg() {
  echo -ne "\e[35m[phoenix-deploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

msg \$phoenixdir is $phoenixdir
msg \$cfgdir is $cfgdir
cd $cfgdir

msg Renaming network interfaces
ip -j addr | jq -r '.[] | [.ifname, (.addr_info[] | select(.family=="inet") | .local)] | @tsv' | while read IFNAME IP; do
  if [[ -z $IP ]] || [[ $IFNAME == lo ]]; then
    continue
  fi
  IFNEWNAME=$(awk -vCT=$CT -vIP=$IP '$0!~/^#/ && NF==4 && $1==CT && $3==IP { print $2 }' ip-map)
  if [[ -n $IFNEWNAME ]]; then
    msg Renaming "$IFNAME" to "$IFNEWNAME"
    ip link set dev "$IFNAME" down
    ip link set dev "$IFNAME" name "$IFNEWNAME"
    ip link set dev "$IFNEWNAME" up
  fi
done

msg Creating dummy network interfaces for /32 allocations
awk -vCT=$CT '
  $0!~/^#/ && NF==4 && $1==CT && $4==32 {
    cmd = "ip link add " $2 " type dummy && ip link set " $2 " up && ip addr add " $3 "/" $4 " dev " $2
    print "# " cmd
    system(cmd)
  }
' ip-map

msg Processing ip-export
$phoenixdir/tools/ph_init/ip-export.sh < ip-map > /run/phoenix-ip-export.sh
. /run/phoenix-ip-export.sh

if [[ $CT == smf* ]] || [[ $CT == udm* ]]; then
  msg Waiting for database
  while ! mysql -e '' -h "$SQL_DB_IP" \
          $(jq -r '.Phoenix.Module[] | select((.name|endswith("smf.so")) or (.name|endswith("udm.so"))) |
                   .config.Database | ["-u", .username, "-p", .password, "-D", .database] | @sh' $CT.json); do
    sleep 1
  done
  sleep 1
fi

if [[ $CT == hostnat ]]; then
  HOSTNAT_MGMT_GW=$(echo $HOSTNAT_MGMT_IP | sed 's/\.[0-9]*$/.1/')
  msg Setting IPv4 default route to $HOSTNAT_MGMT_GW and enabling SNAT to $HOSTNAT_MGMT_IP
  ip route replace default via $HOSTNAT_MGMT_GW
  iptables -t nat -I POSTROUTING -o mgmt -j SNAT --to $HOSTNAT_MGMT_IP
else
  msg Deleting IPv4 default route if exists
  ip route del default || true
fi

if [[ -f other ]]; then
  msg Processing \$cfgdir/other script
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
  msg Processing env.sh
  . env.sh
fi
if [[ -f $CT.sh ]]; then
  msg Processing $CT.sh
  . $CT.sh
fi

if [[ -f $CT.json ]]; then
  msg Starting phoenix process with $CT.json
  exec $phoenixdir/dist/phoenix.sh -j $cfgdir/$CT.json -p $phoenixdir/dist/lib
else
  msg Idling
  exec tail -f
fi
