#!/bin/bash
set -euo pipefail

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m" >/dev/stderr
  echo -n "$*" >/dev/stderr
  echo -e "\e[0m" >/dev/stderr
}

die() {
  msg "$*"
  exit 1
}

assert_state_exists() {
  if ! [[ -f iperf3.state.json ]]; then
    die iperf3 not initialized, please run: 5giperf3 init
  fi
}

DNCPUSET_AVAIL=()
parse_dncpuset() {
  if [[ -z ${D5G_DNCPUSET:-} ]]; then
    return
  fi
  DNCPUSET_AVAIL=($(echo "$D5G_DNCPUSET" | awk -vRS=',' -vFS='-' '
    NF==1 { printf("%d ", $1) }
    NF==2 { for (i=$1; i<=$2; ++i) { print i } }
  '))
}

get_cpuset() {
  local CT=$1
  local CPUSET=$(yq ".services.$CT.cpuset // \"\"" compose.yml)
  if [[ -n $CPUSET ]]; then
    echo $CPUSET
  else
    echo '#'
  fi
}

iperf3_usage() {
  echo "Usage:"
  echo "  alias 5giperf3=\"${BASH_SOURCE[0]}\""
  echo "  5giperf3 init"
  echo "    Initialize iperf3 trafficgen state."
  echo "  5giperf3 add DNN UE-REGED UE-SUBNET START-PORT"
  echo "    Add traffic flows between DN and UEs."
  echo "    DNN: Data Network name, e.g. 'internet'"
  echo "    UE-REGED: UE container name regex, e.g. '^ue1'"
  echo "    UE-SUBNET: UE IPv4 subnet, e.g. '10.1.0.0/16'"
  echo "    START-PORT: starting iperf3 port number, e.g. '20000'"
  echo "  5giperf3 servers"
  echo "    Start iperf3 servers."
  echo "  5giperf3 clients"
  echo "    Start iperf3 clients."
  echo "  5giperf3 wait"
  echo "    Wait for iperf3 clients to finish."
  echo "  5giperf3 collect"
  echo "    Gather statistics."
  echo "  5giperf3 stop"
  echo "    Delete iperf3 servers and clients."
  echo "  5giperf3 each iperf3/*_c.json"
  echo "    Tabulate per-flow throughput."
  echo "  5giperf3 total iperf3/*_c.json"
  echo "    Calculate total throughput."
}

iperf3_init() {
  jq -n '{}' >iperf3.state.json
}

iperf3_add() {
  assert_state_exists
  parse_dncpuset
  local DNN=$1
  local UEREGEX=$2
  local UESUBNET=$3
  local PORT=$4
  shift 4
  local DNCT=dn_${DNN}
  local DNHOST=$(./compose.sh at $DNCT)
  local DNCPUSET=$(get_cpuset $DNCT)
  local DNIP=$(yq ".services.$DNCT.networks.n6.ipv4_address" compose.yml)

  for UECT in $(yq ".services | keys | .[] | select(test(\"$UEREGEX\"))" compose.yml); do
    local UEHOST=$(./compose.sh at $UECT)
    local UECPUSET=$(get_cpuset $UECT)
    msg Finding PDU sessions in $UECT
    local UEIPS=$($UEHOST exec $UECT ip -j addr show to ${UESUBNET} | jq -r '.[].addr_info[].local')
    if [[ -z $UEIPS ]]; then
      msg $UECT has no PDU sessions, perform UE registration and try again
      continue
    fi
    N=0
    for UEIP in $UEIPS; do
      local DNCTCPUSET=$DNCPUSET
      if [[ ${#DNCPUSET_AVAIL[@]} -gt 0 ]]; then
        DNCTCPUSET="${DNCPUSET_AVAIL[0]}"
        DNCPUSET_AVAIL=("${DNCPUSET_AVAIL[@]:1}")
      fi
      local DNCPUSET=$(get_cpuset $DNCT)
      echo "$UECT" "$UEHOST" "$UECPUSET" "$UEIP" "$PORT" "$DNCTCPUSET"
      PORT=$((PORT + 1))
      N=$((N + 1))
    done
    msg Processed $N PDU sessions in $UECT
  done | jq -Rs --arg DNN "$DNN" --arg DNCT "$DNCT" --arg DNHOST "$DNHOST" --arg DNIP "$DNIP" --arg FLAGS "$*" '
    split("\n") | map(
      split(" ") | select(length == 6) |
      ({
        key: ($DNN + "_" + .[4]),
        value: {
          DNN: $DNN,
          DNCT: $DNCT,
          DNHOST: $DNHOST,
          DNCPUSET: (if .[5]=="#" then "" else .[5] end),
          DNIP: $DNIP,
          UECT: .[0],
          UEHOST: .[1],
          UECPUSET: (if .[2]=="#" then "" else .[2] end),
          UEIP: .[3],
          PORT: .[4],
          FLAGS: $FLAGS,
        }
      })
    ) | from_entries
  ' | jq -s '.[0] * .[1]' iperf3.state.json - >iperf3.state-new.json
  mv iperf3.state-new.json iperf3.state.json
}

iperf3_servers() {
  assert_state_exists
  msg Starting iperf3 servers
  jq -r 'to_entries[] | (
    .value.DNHOST + " run -d --name=iperf3_" + .key + "_s" + (if .value.DNCPUSET then " --cpuset-cpus="+.value.DNCPUSET else "" end) +
    " --network=container:" + .value.DNCT + " networkstatic/iperf3" +
    " --forceflush --json -B " + .value.DNIP + " -p " + .value.PORT + " -s"
  )' iperf3.state.json | bash
}

iperf3_clients() {
  assert_state_exists
  msg Starting iperf3 clients
  jq -r 'to_entries[] | (
    .value.UEHOST + " run -d --name=iperf3_" + .key + "_c" + (if .value.UECPUSET then " --cpuset-cpus="+.value.UECPUSET else "" end) +
    " --network=container:" + .value.UECT + " networkstatic/iperf3" +
    " --forceflush --json -B " + .value.UEIP + " -p " + .value.PORT + " --cport " + .value.PORT +
    " -c " + .value.DNIP + " " + .value.FLAGS
  )' iperf3.state.json | bash
}

iperf3_wait() {
  assert_state_exists
  msg Waiting for iperf3 clients to finish
  jq -r 'to_entries[] | (
    .value.UEHOST + " wait iperf3_" + .key + "_c"
  )' iperf3.state.json | bash
}

iperf3_collect() {
  assert_state_exists
  msg Gathering iperf3 statistics to iperf3/\*.json
  mkdir -p iperf3/
  rm -rf iperf3/*.json
  jq -r 'to_entries[] | (
    .value.UEHOST + " logs iperf3_" + .key + "_c | jq -s .[-1] >iperf3/" + .key + "_c.json",
    .value.DNHOST + " logs iperf3_" + .key + "_s | jq -s .[-1] >iperf3/" + .key + "_s.json"
  )' iperf3.state.json | bash
}

iperf3_stop() {
  assert_state_exists
  msg Deleting iperf3 servers and clients
  jq -r 'to_entries[] | (
    .value.UEHOST + " rm -f iperf3_" + .key + "_c",
    .value.DNHOST + " rm -f iperf3_" + .key + "_s"
  )' iperf3.state.json | bash
}

iperf3_each() {
  (
    echo flow send-CPU recv-CPU send-Mbps recv-Mbps
    jq -r 'select(input_filename | endswith("_c.json")) | [
      (input_filename | split("/")[-1][:-7]),
      (if .end.sum.sender then .end.cpu_utilization_percent.host_total else .end.cpu_utilization_percent.remote_total end * 1e3 | round / 1e3),
      (if .end.sum.sender then .end.cpu_utilization_percent.remote_total else .end.cpu_utilization_percent.host_total end * 1e3 | round / 1e3),
      (.end.sum.bits_per_second / 1e3 | round / 1e3),
      ((.end.sum.bits_per_second) * (1-.end.sum.lost_percent/100) / 1e3 | round / 1e3)
    ] | @tsv' "$@"
  ) | column -t
}

iperf3_total() {
  for F in "$@"; do
    if [[ $F == *_c.json ]]; then
      cat $F
    fi
  done | jq -rs 'map((.end.sum.bits_per_second) * (1-.end.sum.lost_percent/100)) | add / 1e3 | round / 1e3'
}

ACT=${1:-usage}
shift
iperf3_${ACT} "$@"
