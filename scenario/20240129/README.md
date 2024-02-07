# Many Slices

## Description

This scenario allows defining large quantity of slices and Data Networks.
There are topology parameters for adjusting Data Networks, UPF, and gNB quantity.

![topology diagram](topo.svg)

## Basic Usage

Generate Compose file:

```bash
cd ~/5gdeploy/scenario
./generate.sh 20240129 +dn=8 +upf=4 +gnb=2
```

The sample command creates 8 Data Networks, evenly distributed among 4 UPFs.
UPFs are named alphabetically; each Data Network Name starts with the connected UPF name, followed by a number assigned sequentially across all DNs.
The `+dn` parameter allows up to 99 DNs, but as tested several 5G implementations start to misbehave when more than 36~50 DNs are defined.

Each Data Network is assigned a distinct S-NSSAI.
If `+same-snssai=true` flag is specified, all Data Networks are assigned the same S-NSSAI instead.

The sample command creates 2 gNBs.
Each gNB comes with minimal quantity of UEs such that all UEs behind each gNB collectively establishes one PDU session toward each DN.
Each UE can have at most 15 PDU sessions, but this can be decreased via `+dn-per-ue=15` command line flag.

## Multi-Host Usage

Multi-host deployment procedure is in development.
It shall support deploying each UPF and the associated Data Networks onto a separate *secondary* host.

## Traffic Generation

Count how many UEs are connected:

```bash
jq -r '.dataNetworks[] | (
  "$(./compose.sh at dn_" + .dnn + ") exec dn_" + .dnn +
  " nmap -sn " + (.subnet|split("/")[0]) + "/24"
)' netdef.json | bash -x
```

It is expected that each `nmap` reports that *U* hosts are up where *U* equals gNB quantity.
This is because there should be exactly one UE attached to each gNB that has a PDU session to each Data Network.

Additional traffic generation procedures are in development.
