#!/bin/bash
set -euo pipefail

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

msg Editing etc/init.conf
N4_IP=$(ip -o addr | awk '$2~"^n4" { split($4,a,"/"); print a[1] }')
sed -i "/node-id/ s|.*|upf node-id ip4 $N4_IP|" etc/init.conf
cat etc/init.conf

msg Editing etc/upf_profile.json
python3 <<EOT
import json
file = open("etc/upf_profile.json", "r+")
profile = json.load(file)
del profile["fqdn"]
file.seek(0)
file.truncate()
json.dump(profile, file, indent=2, sort_keys=True)
EOT
cat etc/upf_profile.json

msg Editing etc/startup_debug.conf
CORE_COUNT=$(awk '$1=="Cpus_allowed_list:" { print $2 }' /proc/1/status | awk -vRS=',' -vFS='-' '
  NF==1 { n += 1 }
  NF==2 { n += $2-$1+1 }
  END { print n }
')
VPP_WORKERS='d'
if [[ $CORE_COUNT -gt 1 ]] && [[ $CORE_COUNT -le 8 ]]; then
  VPP_WORKERS="s|.*|  workers $CORE_COUNT|"
fi
sed -i \
  -e '/main-core/ d' \
  -e "/corelist-workers/ $VPP_WORKERS" \
  etc/startup_debug.conf
cat etc/startup_debug.conf

msg Flushing IP addresses
ip -o addr | awk '$2~"^(n4|n6|n3|n9)" { print "ip addr flush dev " $2 }' | tee /dev/stderr | sh

msg Invoking run.sh
exec /openair-upf/run.sh
