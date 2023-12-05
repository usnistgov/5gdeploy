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
./generate.sh 20231017 +gnbs=2 +phones=12 +vehicles=6
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

## Multi-Host Usage

In this sample, we use three physical/virtual machines, each running these services:

* **main**: Control Plane, gNB and UE simulators.
* **upf1**: UPF1, Data Network `internet`.
* **upf4**: UPF4, Data Network `vcam`, Data Network `vctl`.

Each machine shall have two network interfaces apart from the control interface.

* `CTRL_*` variables define the control interface IP addresses, for SSH usage.
* `N3_*` variables define MAC addresses for N3 network of relevant network functions.
  * QoS rules may be applied on the hardware switch connected to these interfaces.
* `N4_*` variables define MAC addresses for N4 network of relevant network functions.

```bash
# define variables for network interfaces
CTRL_UPF1=192.168.60.2
CTRL_UPF4=192.168.60.3
N3_GNB0=02:00:00:03:00:01
N3_UPF1=02:00:00:03:00:02
N3_UPF4=02:00:00:03:00:03
N4_SMF=02:00:00:04:00:01
N4_UPF1=02:00:00:04:00:02
N4_UPF4=02:00:00:04:00:03

# generate Compose file with bridge support
./generate.sh 20231017 \
  --bridge=n3,eth,gnb0=$N3_GNB0,upf1=$N3_UPF1,upf4=$N3_UPF4 \
  --bridge=n4,eth,smf=$N4_SMF,upf1=$N4_UPF1,upf4=$N4_UPF4

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
If you change gNB quantity in `+gnbs=` flag, you must also edit `--bridge=n3,eth,` flag, so that each gNB has its own N3 network interface.
gNB does not use N4 network, so that `--bridge=n4,eth,` flag can remain unchanged.
