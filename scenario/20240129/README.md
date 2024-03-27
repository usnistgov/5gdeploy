# Many Slices

## Description

This scenario allows defining large quantity of slices and Data Networks.
There are topology parameters for adjusting Data Networks, UPF, and gNB quantity.

![topology diagram](topo.svg)

## Basic Usage

Generate Compose file:

```bash
cd ~/5gdeploy/scenario

# free5GC+UERANSIM
./generate.sh 20240129 +dn=8 +upf=4 +gnb=2 --cp=free5gc --up=free5gc --ran=ueransim

# Open5GCore
./generate.sh 20240129 +dn=8 +upf=4 +gnb=2 +same-snssai=true --cp=phoenix --up=phoenix --ran=phoenix
```

The Compose context is created at `~/compose/20240129`.
See [scenario general README](../README.md) on how to interact with the Compose context, including how to establish PDU sessions from Open5GCore UE simulators.

### Data Networks and UPFs

The `+dn` and `+upfs` flags specify the quantity of Data Networks and UPFs.
You can set up to 99 DNs and up to 8 UPFs; however, initial tests indicate that several 5G implementations start to misbehave when more than 36~50 DNs are defined.
Data Networks are evenly distributed among defined UPFs.
Typically, DN quantity should be no less than UPF quantity, otherwise some UPFs would not receive any traffic.

UPFs are named alphabetically.
Each Data Network Name starts with the connected UPF name, followed by a sequentially assigned number.
These naming schemes are chosen to ease the pattern matching in a multi-host deployment.

The `+same-snssai` flag specifies S-NSSAI assignment:

* `+same-snssai=false` (default) assigns a distinct S-NSSAI to every Data Network.
* `+same-snssai=true` assigns the same S-NSSAI to all Data Networks.
  * This is necessary for `--ran=phoenix`, which only supports no more than 2 distinct S-NSSAIs.

### gNBs and UEs

The `+gnb` flag specifies gNB quantity.
Each gNB comes with minimal quantity of UEs such that all UEs behind each gNB collectively establishes one PDU session toward each DN.

Each UE can have a maximum of 15 PDU sessions.
This can be decreased with `+dn-per-ue` flag.
For example, if the UE simulator supports only 1 PDU session, you can specify `+dn-per-ue=1`.
Note that PacketRusher has a limitation of only 1 PDU session per gNB (not per UE) and will not work with this scenario.

## Multi-Host Usage

In this sample, we define a topology with 2 gNBs, 4 UPFs, and 8 Data Networks.
They are deployed on 3 hosts:

* *primary*: Control Plane, gNB and UE simulators.
* *ab*: `upf_a`, `upf_b`, associated Data Networks.
* *cd*: `upf_c`, `upf_d`, associated Data Networks.

There are two network interfaces available for experiments on each host, used for N3 and N4 networks respectively.
Some network interfaces would be shared between two network functions (containers).

host    | netif | used by
--------|-------|---------------
primary | N3    | gnb0, gnb1
primary | N4    | smf
ab      | N3    | upf\_a, upf\_b
ab      | N4    | upf\_a, upf\_b
cd      | N3    | upf\_c, upf\_d
cd      | N4    | upf\_c, upf\_d

This is just one of many possible setups.
Other setups are possible, including more netif sharing or fewer netif sharing.
Read [multi-host](../../docs/multi-host.md) for explanation about `--bridge` and `--place` flags.

### VXLAN Bridges

These commands create a Compose context using VXLAN bridges:

```bash
# define variables
CTRL_AB=192.168.60.2
CTRL_CD=192.168.60.3
CPUSET_PRIMARY="(4-31)"
CPUSET_AB="(4-15)"
CPUSET_CD="(4-15)"
N3_PRIMARY=192.168.3.1
N3_AB=192.168.3.2
N3_CD=192.168.3.3
N4_PRIMARY=192.168.4.1
N4_AB=192.168.4.2
N4_CD=192.168.4.3

# generate Compose context
./generate.sh 20240129 +dn=8 +upf=4 +gnb=2 +same-snssai=true --cp=phoenix --up=phoenix --ran=phoenix \
  --bridge=n3,vx,$N3_PRIMARY,$N3_AB,$N3_CD \
  --bridge=n4,vx,$N4_PRIMARY,$N4_AB,$N4_CD \
  --place="+(upf|dn)_[ab]*@$CTRL_AB$CPUSET_AB" \
  --place="+(upf|dn)_[cd]*@$CTRL_CD$CPUSET_CD" \
  --place="*@$CPUSET_PRIMARY"

# upload to secondary hosts
~/compose/20240129/compose.sh upload
```

Explanations:

* First and second `--place` flags place UPF and DN containers onto *secondary* hosts, assigning dedicated CPU cores if applicable.
* Last `--place` flags keep the remaining containers (i.e. control plane and RAN simulators) on the *primary* host, but assigns dedicated CPU cores if applicable.
* Each `--bridge` flag creates a VXLAN bridge, interconnecting N3 and N4 networks on all three hosts.
  * Notice that the container names are not listed in these lines, only the host IPs.
  * This implies that, if you move containers between hosts or increase/decrease container quantities, you do not need to change this flag.
  * If you deploy onto more/fewer hosts, you need to change this flag.
* You must assign the IP addresses in `N3_*` and `N4_*` variables to the physical network interfaces on each host, prior to starting the Compose context.

Variations:

* If you have only one network interface for experiment on each host, you can reuse the same IP addresses in `N3_*` and `N4_*` variables.
  * The VXLAN bridges would remain isolated because they would have different VNI.
* If you have only one network interface for both control and experiment on each host, you can reuse the control IP addresses in `N3_*` and `N4_*` variables too.
  * Having VXLAN bridge(s) does not affect other traffic using the same interface and would not unassign these IP addresses.

### Ethernet Bridges with MACVLAN

These commands create a Compose context using Ethernet bridges in MACVLAN mode:

```bash
# define variables
CTRL_AB=192.168.60.2
CTRL_CD=192.168.60.3
CPUSET_PRIMARY="(4-31)"
CPUSET_AB="(4-15)"
CPUSET_CD="(4-15)"
N3_PRIMARY=02:00:00:03:00:01
N3_AB=02:00:00:03:00:02
N3_CD=02:00:00:03:00:03
N4_PRIMARY=02:00:00:04:00:01
N4_AB=02:00:00:04:00:02
N4_CD=02:00:00:04:00:03

# generate Compose context
./generate.sh 20240129 +dn=8 +upf=4 +gnb=2 +same-snssai=true --cp=phoenix --up=phoenix --ran=phoenix \
  --bridge="n3,eth,gnb*@$N3_PRIMARY,upf_[ab]@$N3_AB,upf_[cd]@$N3_CD" \
  --bridge="n4,eth,smf@$N4_PRIMARY,upf_[ab]@$N4_AB,upf_[cd]@$N4_CD" \
  --place="+(upf|dn)_[ab]*@$CTRL_AB$CPUSET_AB" \
  --place="+(upf|dn)_[cd]*@$CTRL_CD$CPUSET_CD" \
  --place="*@$CPUSET_PRIMARY"

# upload to secondary hosts
~/compose/20240129/compose.sh upload
```

Explanations:

* `--place` flags are same as the VXLAN setup.
* Each `--bridge` flag replaces a Docker network with an Ethernet bridge, connected via an external Ethernet switch.
  * Notice that every container name on the Docker network must be listed in these lines.
  * This implies that, if you increase/decrease container quantities, you must change this flag accordingly.
  * You can find out the container names by reading the single-host Compose file.
* The `@` operator makes each container use a MACVLAN sub-interface.
  * This allows sharing a physical Ethernet adapter among multiple containers.
  * Each container will have its own distinct MAC address, which would be seen on the external Ethernet switch.
  * This may not work inside a virtual machine if the "physical" Ethernet adapter is virtualized.
  * This may not work if the external Ethernet switch restricts which MAC addresses are allowed on each port.

Variations:

* You can reuse the same physical Ethernet adapter for both N3 and N4, by writing the same MAC addresses in both `--bridge` flags.
  * The traffic would appear "mixed" on the external Ethernet switch, but the scenario should still work because each network interface has distinct IPv4 addresses.
* You can reuse the same physical Ethernet adapter for both control and experiment traffic.
  * Having MACVLAN sub-interface(s) does not affect other traffic using the same physical Ethernet adapter.
* You can mix-and-match VXLAN and Ethernet bridges, such as Ethernet bridge for N3 and VXLAN bridge for N4.
  Each `--bridge` flag shall follow the syntax of the chosen bridge type.

## Traffic Generation

### nmap

Count how many UEs are connected:

```bash
cd ~/compose/20240129
jq -r '.dataNetworks[] | (
  "$(./compose.sh at dn_" + .dnn + ") exec dn_" + .dnn +
  " nmap -sn " + (.subnet|sub("/\\d+";"/24"))
)' netdef.json | bash -x
```

It is expected for each `nmap` to report that *U* hosts are up, where *U* equals gNB quantity.
This is because there should be exactly one UE attached to each gNB that has a PDU session to each Data Network.

### iperf3

See [trafficgen](../../trafficgen/README.md).
