#!/bin/bash
set -euo pipefail
MODE=$1
SHCNT=$2
WORKERPREFIX=$3
WORKERS=$4
mkdir -p /tmp/5gdeploy-taskset
cd /tmp/5gdeploy-taskset
sleep 20

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
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
if [[ $(wc -l <cores.tsv) -ne $((SHCNT + WORKERS)) ]] && [[ $(head -1 cores.tsv) -eq 0 ]]; then
  msg Insufficient cores or unconfigured CPU isolation, not setting CPU affinity
  exit
fi

while ! [[ -f workers.tsv ]] || [[ $(wc -l <workers.tsv) -ne $WORKERS ]]; do
  sleep 1
  ps Hwwx -o 'tid comm command' --no-headers | awk '
    $3 != "/opt/phoenix/dist/bin/phoenix" { next }
    { print $1 " " $2 > "threads.tsv" }
    $2 ~ /^'$WORKERPREFIX'/ { print $1 " " $2 > "workers.tsv" }
  '
done
msg Found $(wc -l <threads.tsv) phoenix threads including $WORKERS workers
cat threads.tsv

AWKVARS=
case $MODE in
  shhi)
    AWKVARS="-vA=0 -vSLO=$((WORKERS + 1)) -vSHI=$((WORKERS + SHCNT))"
    ;;
  shlo)
    AWKVARS="-vA=$SHCNT -vSLO=1 -vSHI=$SHCNT"
    ;;
esac

msg Setting CPU affinity for phoenix threads
awk $AWKVARS '
  FILENAME == "cores.tsv" {
    C[FNR] = $1
    next
  }
  FNR == 1 {
    for (i = SLO; i <= SHI; ++i) { 
      S = S C[i] ","
    }
    S = substr(S, 1, length(S)-1)
  }
  $2 ~ /^'$WORKERPREFIX'/ {
    system("taskset -pc " C[++A] " " $1)
    next
  }
  {
    system("taskset -pc " S " " $1)
  }
' cores.tsv threads.tsv
