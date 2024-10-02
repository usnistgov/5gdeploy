#!/bin/bash
set -euo pipefail
MODE=$1
WORKERS=$2
mkdir -p /tmp/upf-taskset
cd /tmp/upf-taskset
sleep 20

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

linecount() {
  wc -l $1 | cut -d' ' -f1
}

awk '$1=="Cpus_allowed_list:" { printf "%s", $2 }' /proc/1/status | awk -vRS=',' -vFS='-' '
  NF==1 {
    print $1
  }
  NF==2 {
    for (c=$1; c<=$2; ++c) {
      print c
    }
  }
' >cores.tsv
if [[ $(linecount cores.tsv) -ne $((1 + WORKERS)) ]] && [[ $(head -1 cores.tsv) -eq 0 ]]; then
  msg Insufficient cores or unconfigured CPU isolation, not setting CPU affinity
  exit
fi

while ! [[ -f fwds.tsv ]] || [[ $(linecount fwds.tsv) -ne $WORKERS ]]; do
  ps Hww -o 'tid comm command' --no-headers | awk '
    $3 != "/opt/phoenix/dist/bin/phoenix" { next }
    { print $1 " " $2 > "threads.tsv" }
    $2 ~ /^UPFSockFwd_/ { print $1 " " $2 > "fwds.tsv" }
  '
done
msg Found $(linecount threads.tsv) UPF threads including $WORKERS forwarding workers
cat threads.tsv

AWKVARS=
case $MODE in
  1)
    AWKVARS="-vA=0 -vS=$((1 + WORKERS))"
    ;;
  -1)
    AWKVARS="-vA=1 -vS=1"
    ;;
esac

msg Setting CPU affinity for UPF threads
awk $AWKVARS '
  FILENAME == "cores.tsv" {
    C[NR] = $1
    next
  }
  $2 ~ /^UPFSockFwd_/ {
    system("taskset -pc " C[++A] " " $1)
    next
  }
  {
    system("taskset -pc " C[S] " " $1)
  }
' cores.tsv threads.tsv
