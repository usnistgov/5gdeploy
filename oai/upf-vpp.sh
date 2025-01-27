#!/bin/bash
set -euo pipefail

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

msg Listing IP addresses
ip addr

msg Showing etc/init.conf
cat etc/init.conf

msg Showing etc/startup_debug.conf
cat etc/startup_debug.conf

msg Editing etc/upf_profile.json
python3 <<EOT
import json
import os

file = open("etc/upf_profile.json", "r+")
profile = json.load(file)

upfInfo = profile['upfInfo']
upfInfo['sNssaiUpfInfoList'] = json.loads(os.environ['PROFILE_SUIL'])
profile['sNssais'] = [sui["sNssai"] for sui in upfInfo['sNssaiUpfInfoList']]

upfInfo['interfaceUpfInfoList'] = [
    iui for iui in upfInfo['interfaceUpfInfoList'] if iui['interfaceType'] != 'N9']
upfInfo['interfaceUpfInfoList'] += json.loads(
    os.environ['PROFILE_IUIL'])

file.seek(0)
file.truncate()
json.dump(profile, file, indent=2, sort_keys=True)
EOT
cat etc/upf_profile.json
echo

msg Flushing IPv4 addresses
ip -o -4 addr | awk '$2~"^(n4|n6|n3|n9)" { print "ip -4 addr flush dev " $2 }' | sh -x

msg Invoking run.sh
exec /openair-upf/run.sh
