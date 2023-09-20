# 3-Slice with Unshared UPFs

## Description

There are three slices:

* sst=1, dnn=internet: generic cellphone, `10.1.0.0/16`.
* sst=140, dnn=vcam: remote driving camera stream, `10.140.0.0/16`.
* sst=141, dnn=vctl: remote driving control stream, `10.141.0.0/16`.

Each slice is served by a dedicated UPF.
All control plane network functions are shared.

There are 50 cellphones and 10 vehicles, sharing 2 gNBs.
These quantities can be adjusted by editing the constants in `scenario.ts`.

## Usage

First complete the installation steps in [top-level README](../README.md).

Generate Compose file:

```bash
cd ~/5gdeploy-scenario
bash generate.sh 20230817 --ran=ueransim
# --ran=ueransim is required.
# Open5GCore gNB simulator allows up to 2 slices so it is incompatible.
#
# Add --up=free5gc to select free5GC UPF instead of Open5GCore UPF.
```

The Compose file is placed at `~/compose/20230817`.
You can interact with the Compose file and Docker containers in the usual way.

Count how many UEs are connected:

```bash
docker exec dn_internet nmap -sn 10.1.0.0/24
docker exec dn_vcam nmap -sn 10.140.0.0/24
docker exec dn_vctl nmap -sn 10.141.0.0/24
```

Start traffic generators:

```bash
start_iperf3_ue_dn() {
  local DNN=$1
  local UESUBNET=$2
  local PORT=$3
  shift 3
  local DNCT=dn_${DNN}
  local DNIP=$(docker exec $DNCT ip -j route get ${UESUBNET%/*} | jq -r '.[0].prefsrc')
  local CRUN=': '
  for I in $(seq 0 9999); do
    local UECT=ue$I
    if ! docker inspect $UECT &>/dev/null; then
      break
    fi
    local UEIPS=$(docker exec $UECT ip -j addr show to ${UESUBNET} | jq -r '.[].addr_info[].local')
    if [[ -z $UEIPS ]]; then
      continue
    fi
    for UEIP in $UEIPS; do
      docker run -d --name iperf3_${DNN}_${PORT}_s --network container:$DNCT networkstatic/iperf3 --forceflush -B $DNIP -p $PORT -s
      CRUN=$CRUN"; docker run -d --name iperf3_${DNN}_${PORT}_c --network container:$UECT networkstatic/iperf3 --forceflush -B $UEIP -p $PORT --cport $PORT -c $DNIP $*"
      PORT=$((PORT+1))
    done
  done
  sleep 10
  bash -c "$CRUN"
}

start_iperf3_ue_dn vcam 10.140.0.0/16 20000 -t 300 -u -b 7M
start_iperf3_ue_dn vctl 10.141.0.0/16 20000 -t 300 -u -b 50K -R
start_iperf3_ue_dn internet 10.1.0.0/16 20000 -t 300 -u -b 15M
start_iperf3_ue_dn internet 10.1.0.0/16 21000 -t 300 -u -b 50M -R
```

Stop traffic generators:

```bash
# stop and gather logs
for CT in $(docker ps -a --format=json | jq -r '.Names | select(. | startswith("iperf3"))' | sort -V); do
  echo '----------------------------------------------------------------'
  echo $CT
  docker kill --signal=INT $CT
  docker logs $CT
  docker rm -f $CT
done &>~/compose/20230817/iperf3.log

# stop without gathering logs
docker rm -f $(docker ps -a --format=json | jq -r '.Names | select(. | startswith("iperf3"))')
```

## Multi-Host Usage

We want to run Control Plane on primary host (`192.168.60.1`), User Plane and RAN on secondary host (`192.168.60.2`).
See the multi-host preparation steps in [top-level README](../README.md).

```bash
# generate Compose file with bridge support
bash generate.sh 20230817 --bridge-on=n2,n3,n4 --bridge-to=192.168.60.1,192.168.60.2

# copy Compose file and config folder to the secondary host
eval `ssh-agent -s` && ssh-add
rclone sync ~/compose/20230817 :sftp:compose/20230817 --sftp-host=secondary
eval `ssh-agent -k`

# start CP on the primary host
docker compose up -d bridge $(yq '.services | keys | filter(test("^(dn|upf|gnb|ue)[_0-9]") | not) | .[]' compose.yml)

# start UP and RAN on the second host
docker -H ssh://secondary compose up -d bridge $(yq '.services | keys | filter(test("^(dn|upf|gnb|ue)[_0-9]")) | .[]' compose.yml)
```
