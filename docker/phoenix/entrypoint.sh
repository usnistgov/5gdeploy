#!/bin/bash
set -euo pipefail
CT=$1

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

msg \$phoenixdir is $phoenixdir
msg \$cfgdir is $cfgdir
cd $cfgdir

msg Preparing network interfaces
awk -vCT=$CT 'NF==4 && $1==CT { print $2, $3 }' ip-map | while read IFNAME IP; do
  IFOLDNAME=$(ip -j addr show to $IP | jq -r '.[].ifname')
  if [[ -n $IFOLDNAME ]]; then
    msg Renaming $IFOLDNAME to $IFNAME
    ip link set dev $IFOLDNAME down
    ip link set dev $IFOLDNAME up name $IFNAME
  else
    msg Waiting for $IFNAME to appear
    pipework --wait -i $IFNAME
  fi
  msg Disabling TX checksum offload on $IFNAME
  ethtool --offload $IFNAME tx off || msg Cannot disable TX checksum on $IFNAME, outgoing packets may carry bad checksum and get dropped
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
$phoenixdir/tools/ph_init/ip-export.sh <ip-map >/run/phoenix-ip-export.sh
. /run/phoenix-ip-export.sh

if [[ $CT == hostnat ]]; then
  HOSTNAT_MGMT_GW=$(sed 's/\.[0-9]*$/.1/' <<<$HOSTNAT_MGMT_IP)
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

msg Listing IP addresses
ip addr
msg Listing IP routing policy rules
ip rule list
msg Listing IP routes
ip route list table all type unicast

if [[ -f env.sh ]]; then
  msg Processing env.sh
  . env.sh
fi
if [[ -f $CT.sh ]]; then
  msg Processing $CT.sh
  . $CT.sh
fi
if ! [[ -f $CT.json ]]; then
  msg Idling
  exec tail -f
fi

for NFDB in nssf:database smf:Database udm:Database udr:Database; do
  NF=${NFDB%:*}
  if [[ $CT != ${NF}* ]]; then
    continue
  fi
  msg Waiting for $NF database
  while ! mysql -eQUIT $(jq -r --arg NF "$NF" --arg DB "${NFDB#*:}" '
    .Phoenix.Module[] | select(.binaryFile|endswith("/"+$NF+".so")) | .config[$DB] | [
      "-h" + (.hostname | if .|startswith("%") then env[.[1:]] else . end),
      "-u" + .username, "-p" + .password, "-D" + .database, "-s"
    ] | join(" ")' $CT.json); do
    sleep 1
  done
  sleep 1
done

msg Starting phoenix process with $CT.json
export XDP_GTP=$phoenixdir/dist/lib/objects-Debug/xdp_program_files/xdp_gtp.c.o
exec $phoenixdir/dist/phoenix.sh -j $cfgdir/$CT.json -p $phoenixdir/dist/lib
