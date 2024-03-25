# 5gdeploy/packetrusher

Package **packetrusher** generates [PacketRusher](https://github.com/HewlettPackard/PacketRusher) configuration.
This package offers these choices in the **netdef-compose** command:

* `--ran=packetrusher`
  * gNB can only connect to the first AMF
  * there must be exactly one UE connected to each gNB

PacketRusher depends on gtp5g kernel module.
See [free5GC README](../free5gc/README.md) for how to load this kernel module.
