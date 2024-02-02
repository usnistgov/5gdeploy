# Phones and Vehicles, 2-Slice with 2 UPFs

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

Generate Compose file:

```bash
cd ~/5gdeploy/scenario
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
for UECT in $(docker ps --format='{{.Names}}' | grep '^ue'); do
  corepack pnpm -s phoenix-rpc --host=$UECT ue-register '--dnn=*'
done
# note: In multi-host deployment, this only works for UEs running on the primary host. If some UEs
# are placed on secondary hosts, you'll need to install 5gdeploy on each secondary host and run
# this command from there.
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
* `CPUSET_*` variables define a list of CPU cores on each host for CPU isolation.
  * To disable CPU isolation, set them to empty strings.
* `N3_*` variables define MAC addresses for N3 network of relevant network functions.
  * QoS rules may be applied on the hardware switch connected to these interfaces.
* `N4_*` variables define MAC addresses for N4 network of relevant network functions.

```bash
# define variables for network interfaces
CTRL_UPF1=192.168.60.2
CTRL_UPF4=192.168.60.3
CPUSET_PRIMARY="(2-11)"
CPUSET_UPF1="(2-11)"
CPUSET_UPF4="(2-11)"
N3_GNB0=02:00:00:03:00:01
N3_UPF1=02:00:00:03:00:02
N3_UPF4=02:00:00:03:00:03
N4_SMF=02:00:00:04:00:01
N4_UPF1=02:00:00:04:00:02
N4_UPF4=02:00:00:04:00:03

# generate Compose file
./generate.sh 20231017 \
  --bridge=n3,eth,gnb0=$N3_GNB0,upf1=$N3_UPF1,upf4=$N3_UPF4 \
  --bridge=n4,eth,smf=$N4_SMF,upf1=$N4_UPF1,upf4=$N4_UPF4 \
  --place="+(upf1|dn_internet)@$CTRL_UPF1$CPUSET_UPF1" \
  --place="+(upf4|dn_v*)@$CTRL_UPF4$CPUSET_UPF4" \
  --place="*@$CPUSET_PRIMARY"

# upload Compose file and config folder to secondary hosts
../upload.sh ~/compose/20231017 $CTRL_UPF1 $CTRL_UPF4

# start the scenario
~/compose/20231017/compose.sh up

# stop the scenario
~/compose/20231017/compose.sh down
```

This scenario has 1 gNB by default.
If you change gNB quantity in `+gnbs=` flag, you must also edit `--bridge=n3,eth,` flag, so that each gNB has its own N3 network interface.
gNB does not use N4 network, so that `--bridge=n4,eth,` flag can remain unchanged.

## SONiC Switch QoS Setting

`sonic-qos.ts` generates QoS configuration for [SONiC](https://github.com/sonic-net/SONiC) Ethernet switches.

* `--port-gnb`: SONiC switchport connected to gNB
  * this flag is repeatable if there are multiple gNBs
* `--port-upf1`: SONiC switchport connected to UPF1
* `--port-upf4`: SONiC switchport connected to UPF4
* `--dl-gnb`: maximum downlink rate toward each gNB in Mbps
* `--dl-sched`: downlink scheduler type
  * `--dl-sched=STRICT`: strict priority - UPF4 has higher priority than UPF1
  * `--dl-sched=WRR`: Weighted Round Robin algorithm
  * `--dl-sched=DWRR`: Deficit Weighted Round Robin algorithm
* `--dl-w1`: weight for UPF1-to-gNB traffic, integer between 1 and 100
* `--dl-w4`: weight for UPF4-to-gNB traffic, integer between 1 and 100
  * effective with WRR or DWRR scheduler type
* `--format`: output format
  * `--format=patch`: print JSON patch (default)
  * `--format=pretty`: pretty-print JSON patch
  * `--format=shell`: print SONiC shell command that applies the patch

```bash
# define variables for switch ports
SWPORT_GNB0=Ethernet8
SWPORT_UPF1=Ethernet0
SWPORT_UPF4=Ethernet1

# generate SONiC config
$(corepack pnpm bin)/tsx 20231017/sonic-qos.ts --format=shell \
  --port-gnb=$SWPORT_GNB0 --port-upf1=$SWPORT_UPF1 --port-upf4=$SWPORT_UPF4 \
  --dl-gnb=2000 --dl-sched=STRICT

$(corepack pnpm bin)/tsx 20231017/sonic-qos.ts --format=shell \
  --port-gnb=$SWPORT_GNB0 --port-upf1=$SWPORT_UPF1 --port-upf4=$SWPORT_UPF4 \
  --dl-gnb=2000 --dl-sched=DWRR --dl-w1=20 --dl-w4=80
```
