#!/bin/bash
set -euo pipefail
CT=$1

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

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
export XDP_GTP=/opt/phoenix/dist/lib/objects-Debug/xdp_program_files/xdp_gtp.c.o
exec /opt/phoenix/dist/phoenix.sh -j $CT.json -p /opt/phoenix/dist/lib
