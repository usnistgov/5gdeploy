# 5gdeploy/netdef-compose

Command **netdef-compose** generates Compose file and config folder from a [network definition](../netdef).

## Basic Usage

View help:

```bash
corepack pnpm netdef-compose --help
```

Generate Compose file and config folder with default settings:

```bash
corepack pnpm netdef-compose --netdef ~/netdef.json --out ~/compose/example
```

## Choose 5G Implementations

You can choose Control Plane, User Plane, and Radio Access Network implementations independently.
Example command:

```bash
corepack pnpm netdef-compose --netdef ~/netdef.json --out ~/compose/example \
  --cp=free5gc --up=free5gc --ran=ueransim
```

The default combination is `--cp=phoenix --up=phoenix --ran=phoenix` (subject to change).
If you installed 5gdeploy with `NOPHOENIX=1` environ (Open5GCore disabled), you must explicitly choose other 5G implementations or the generation will fail.

Due to incompatibilities in 5G implementations, not every combinations will work.
These combinations are verified to be compatible:

* `--cp=free5gc --up=free5gc --ran=gnbsim`
* `--cp=free5gc --up=free5gc --ran=ueransim`
* `--cp=oai --up=oai --ran=gnbsim`
* `--cp=oai --up=oai --ran=oai`
* `--cp=oai --up=oai --ran=packetrusher`
* `--cp=oai --up=oai --ran=ueransim`
* `--cp=oai --up=oai-vpp --ran=packetrusher`
* `--cp=oai --up=oai-vpp --ran=ueransim`
* `--cp=phoenix --up=free5gc --ran=oai`
* `--cp=phoenix --up=free5gc --ran=phoenix`
* `--cp=phoenix --up=free5gc --ran=ueransim`
* `--cp=phoenix --up=phoenix --ran=packetrusher`
* `--cp=phoenix --up=phoenix --ran=phoenix`
* `--cp=phoenix --up=phoenix --ran=ueransim`

## IP Address Assignment

5gdeploy assigns internal IPv4 addresses of 5G network functions in two parts:

* Each virtual network is assigned a /24 subnet.
* Each network function is assigned a unique host number.
  This implies 5gdeploy can accommodate up to 253 network functions.

The `--ip-space` flag sets the overall address space.
This can be used to avoid conflicts with physical equipment address space and UE subnets.
The minimal subnet size is /18, which allows up to 64 virtual networks.

The `--ip-fixed` flag sets a fixed IPv4 address to an interface in a network function.
This can be used to provide stability for interconnecting with external devices such as physical gNBs.
The fixed addresses need not fall within the overall address space.
5gdeploy will take over the enclosing /24 subnet for assigning addresses to other network functions on the same virtual network.

Example:

```text
--ip-space=192.168.64.0/18
--ip-fixed=amf,n2,192.168.2.11
--ip-fixed=smf,n4,192.168.4.12
```

## Multi-Host Usage

You can deploy a scenario over multiple physical/virtual machines, with a subset of network functions placed on each machine, by specifying `--bridge` and `--place` command line flags.
See [multi-host deployment](../docs/multi-host.md) for more information.
