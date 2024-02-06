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

This will create 8 Data Networks, evenly distributed among 4 UPFs.
The maximum Data Networks quantity in the topology parameter is 99, but as tested several 5G implementations start to misbehave when more than 36~50 Data Networks are defined.

There are 2 gNBs.
Each gNB has the fewest possible quantity of UEs, so that there is one PDU session to every Data Network from each gNB.

## Multi-Host Usage

Multi-host deployment procedure is in development.
It shall support deploying each UPF and the associated Data Networks onto a separate *secondary* host.

## Traffic Generation

Traffic generation procedure is in development.
