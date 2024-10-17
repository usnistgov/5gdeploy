# 5gdeploy/packetrusher

Package **packetrusher** generates [PacketRusher](https://github.com/HewlettPackard/PacketRusher) configuration.
This package offers these choices in the **netdef-compose** command:

* `--ran=packetrusher`

PacketRusher can operate in either control plane mode or GTP-U tunnel mode, described below.
In either mode, only the first Data Network defined in the NetDef subscriber is connected to.

## Control Plane Mode

In control plane mode, PacketRusher performs control plane signaling procedures including UE registration and PDU session establishment, but it isn't possible to send user traffic through the PDU sessions.
To use this mode, there must be exactly one NetDef subscriber connected to each gNB, in which the subscriber has a `.count` greater than 1 to define multiple UEs with consecutive SUPIs.

## GTP-U Tunnel Mode

In GTP-U tunnel mode, PacketRusher performs control plane signaling procedures and then creates a GTP-U tunnel netif that allows user traffic through the PDU session.
To use this mode, there must be exactly one UE (NetDef subscriber with `.count` equal to 1) connected to each gNB.

When using GTP-U tunnel mode, PacketRusher depends on gtp5g kernel module.
See [free5GC README](../free5gc/README.md) for how to load this kernel module.
