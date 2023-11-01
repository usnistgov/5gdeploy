# 3-Slice with Unshared UPFs

## Description

There are three slices:

* sst=1, dnn=internet: generic cellphone, `10.1.0.0/16`.
* sst=140, dnn=vcam: remote driving camera stream, `10.140.0.0/16`.
* sst=141, dnn=vctl: remote driving control stream, `10.141.0.0/16`.

Each slice is served by a dedicated UPF.
All control plane network functions are shared.

There are 48 cellphones and 12 vehicles, sharing 2 gNBs.
These quantities can be adjusted via command line flags.

## Usage

First complete the installation steps in [top-level README](../README.md).

Generate Compose file:

```bash
cd ~/5gdeploy-scenario
./generate.sh 20230817 --ran=ueransim
# --ran=ueransim is required.
# Open5GCore gNB simulator allows up to 2 slices so it is incompatible.
#
# Add --up=free5gc to select free5GC UPF instead of Open5GCore UPF.

# adjust gNB and UE quantities
./generate.sh 20230817 +gnbs=3 +phones=15 +vehicles=6 --ran=ueransim
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
  for UECT in $(docker ps -a --format='{{.Names}}' | grep '^ue[0-9]'); do
    local UEIPS=$(docker exec $UECT ip -j addr show to ${UESUBNET} | jq -r '.[].addr_info[].local')
    if [[ -z $UEIPS ]]; then
      continue
    fi
    for UEIP in $UEIPS; do
      docker run -d --name iperf_${DNN}_${PORT}_s --network container:$DNCT networkstatic/iperf3 --forceflush -B $DNIP -p $PORT -s
      CRUN=$CRUN"; docker run -d --name iperf_${DNN}_${PORT}_c --network container:$UECT networkstatic/iperf3 --forceflush -B $UEIP -p $PORT --cport $PORT -c $DNIP $*"
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
for CT in $(docker ps -a --format='{{.Names}}' | grep '^iperf_' | sort -V); do
  echo '----------------------------------------------------------------'
  echo $CT
  docker kill --signal=INT $CT
  docker logs $CT
  docker rm -f $CT
done &>~/compose/20230817/iperf3.log

# stop without gathering logs
docker rm -f $(docker ps -a --format='{{.Names}}' | grep '^iperf_')
```

## Multi-Host Usage

We want to run Control Plane on primary host, User Plane and RAN on secondary host.
See the multi-host preparation steps in [top-level README](../README.md).

```bash
# define variables for SSH hostnames or IPs
CTRL_UP=192.160.60.2

# define variables for experiment network IPs
EXP_CP=192.168.60.1
EXP_UP=192.168.60.2

# generate Compose file with bridge support
./generate.sh 20230817 --ran=ueransim \
  --bridge=n2,vx,$EXP_CP,$EXP_UP \
  --bridge=n3,vx,$EXP_CP,$EXP_UP \
  --bridge=n4,vx,$EXP_CP,$EXP_UP

# upload Compose file and config folder to the secondary host
./upload.sh ~/compose/20230817 :sftp:compose/20230817 $CTRL_UP

# start CP on the primary host
docker compose up -d bridge $(yq '.services | keys | filter(test("^(dn|upf|gnb|ue)[_0-9]") | not) | .[]' compose.yml)

# start UP and RAN on the second host
docker -H ssh://$CTRL_UP compose up -d bridge $(yq '.services | keys | filter(test("^(dn|upf|gnb|ue)[_0-9]")) | .[]' compose.yml)
```

## Physical Ethernet Ports

It is possible to use physical Ethernet ports in select network functions.
This would allow, for example, QoS enforcement through hardware switches.

```bash
# define variables for host interface MAC addresses
MAC_N3_GNB0=02:00:00:03:00:01
MAC_N3_GNB1=02:00:00:03:00:02
MAC_N3_UPF1=02:00:00:03:00:03
MAC_N3_UPF140=02:00:00:03:00:04
MAC_N3_UPF141=02:00:00:03:00:05

# generate Compose file with physical ports support
./generate.sh 20230817 --ran=ueransim \
  --bridge=n3,eth,gnb0=$MAC_N3_GNB0,gnb1=$MAC_N3_GNB1,upf1=$MAC_N3_UPF1,upf140=$MAC_N3_UPF140,upf141=$MAC_N3_UPF141
```

The `--bridge=net,eth,` flag must list all containers on a network.
The operator between a container name and a host interface MAC address could be either `=` or `@`.

* The `=` operator moves the host interface into the container.
  It becomes inaccessible from the host and cannot be shared among multiple containers.
  The original MAC address is used by the container.
* The `@` operator creates a MACVLAN subinterface on the host interface.
  The host interface remains accessible on the host.
  Multiple containers may share the same host interface, and each container gets its own MAC address.
  Currently this uses MACVLAN "bridge" mode, so that traffic between two containers on the same host interface is switched internally in the Ethernet adapter and does not appear on the connected Ethernet switch.
