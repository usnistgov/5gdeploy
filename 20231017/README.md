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

See traffic generation procedure in [20230817 scenario](../20230817/README.md).
