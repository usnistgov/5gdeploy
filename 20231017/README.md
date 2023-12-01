# 2-Slice with Unshared UPFs

## Description

There are two slices and three Data Networks:

* sst=1, sd=0x000000, dnn=internet: generic cellphone, `10.1.0.0/16`.
* sst=4, sd=0x000000, dnn=vcam: remote driving camera stream, `10.140.0.0/16`.
* sst=4, sd=0x000000, dnn=vctl: remote driving control stream, `10.141.0.0/16`.

Each slice is served by a dedicated UPF, while Data Networks on the same slice share the same UPF.
All control plane network functions are shared.

There are 6 cellphones and 2 vehicles, sharing 1 gNB.
These quantities can be adjusted via command line flags.

## Basic Usage

First complete the installation steps in [top-level README](../README.md).

Generate Compose file:

```bash
cd ~/5gdeploy-scenario
./generate.sh 20231017
# Add --up=free5gc to select free5GC UPF instead of Open5GCore UPF.
# Add --ran=ueransim to select UERANSIM gNB+UE instead of Open5GCore gNB+UE.

# adjust gNB and UE quantities
./generate.sh 20231017 +gnbs=2 +phones=12 +vehicles=6 --ran=ueransim
# UERANSIM is recommended if large UE quantity is desired.
```

The Compose file is placed at `~/compose/20231017`.
You can interact with the Compose file and Docker containers in the usual way.

Establish PDU sessions from Open5GCore UEs:

```bash
cd ~/5gdeploy
for UECT in $(docker ps --format='{{.Names}}' | grep '^ue1'); do
  corepack pnpm -s phoenix-rpc --host=$UECT ue-register --dnn=internet
done
for UECT in $(docker ps --format='{{.Names}}' | grep '^ue4'); do
  corepack pnpm -s phoenix-rpc --host=$UECT ue-register --dnn=vcam --dnn=vctl
done
```

## Traffic Generation

See [trafficgen](../20230817/trafficgen.md) for suggestions on how to generate traffic in this scenario.

## Traffic Generation

See traffic generation procedure in [20230817 scenario](../20230817/README.md).

When using Open5GCore UE, this scenario is compatible with [ns-3 3GPP HTTP applications](https://www.nsnam.org/docs/release/3.35/models/html/applications.html).

```bash
# start 3GPP HTTP server in Data Network 'internet'
docker run -d --name ns3http_internet --cap-add=NET_ADMIN --device /dev/net/tun \
  --network container:dn_internet -e NS_LOG=ThreeGppHttpServer \
  5gdeploy.localhost/ns3http 0 n6 --listen

# start 3GPP HTTP clients in ue1000
SERVER=$(docker exec dn_internet ip -j route get 10.1.0.0 | jq -r '.[0].prefsrc')
docker run -d --name ns3http_ue1000 --cap-add=NET_ADMIN --device /dev/net/tun \
  --network container:ue1000 -e NS_LOG=ThreeGppHttpClient \
  5gdeploy.localhost/ns3http 0 10.1.0.0/16 --connect=$SERVER --clients=100

# gather logs and stop applications
docker logs ns3http_internet &>ns3http_internet.log
docker logs ns3http_ue1000 &>ns3http_ue1000.log
docker rm -f ns3http_internet ns3http_ue1000
```

## Multi-Host Usage

In this sample, we use three physical/virtual machines, each running these services:

* **main**: Control Plane, gNB and UE simulators.
* **upf1**: UPF1, Data Network `internet`.
* **upf4**: UPF4, Data Network `vcam`, Data Network `vctl`.

Each machine shall have two network interfaces apart from the control interface.

* `CTRL_*` variables define the control interface IP addresses, for SSH usage.
* `EXP_*` variables define the primary experiment network IP addresses, for VXLAN bridging.
  * N4 network of the 5G core is bridged via VXLAN.
* `N3_*` variables define the N3 network MAC addresses, specifically for N3 network of the 5G core.
  * QoS rules may be applied on the hardware switch connected to these interfaces.

```bash
# define variables for network interfaces
CTRL_UPF1=192.168.60.2
CTRL_UPF4=192.168.60.3
EXP_MAIN=192.168.61.1
EXP_UPF1=192.168.61.2
EXP_UPF4=192.168.61.3
N3_GNB0=02:00:00:03:00:01
N3_UPF1=02:00:00:03:00:02
N3_UPF4=02:00:00:03:00:03

# generate Compose file with bridge support
./generate.sh 20231017 \
  --bridge=n3,eth,gnb0=$N3_GNB0,upf1=$N3_UPF1,upf4=$N3_UPF4 \
  --bridge=n4,vx,$EXP_MAIN,$EXP_UPF1,$EXP_UPF4

# upload Compose file and config folder to secondary hosts
./upload.sh ~/compose/20231017 $CTRL_UPF1 $CTRL_UPF4

# start the scenario
cd ~/compose/20231017
docker compose up -d bridge $(yq '.services | keys | filter(test("^(dn|upf)[_0-9]") | not) | .[]' compose.yml)
docker -H ssh://$CTRL_UPF1 compose up -d bridge upf1 dn_internet
docker -H ssh://$CTRL_UPF4 compose up -d bridge upf4 dn_vcam dn_vctl

# stop the scenario
docker compose down --remove-orphans
docker -H ssh://$CTRL_UPF1 compose down --remove-orphans
docker -H ssh://$CTRL_UPF4 compose down --remove-orphans
```

This scenario has 1 gNB by default.
If you change gNB quantity in `+gnbs=` flag, you must edit `--bridge=n3,eth,` flag correspondingly so that every gNB has its own N3 network interface; `--bridge=n3,vx,` flag does not need changes.
