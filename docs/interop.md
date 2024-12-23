# Interoperability between 5G Implementations

Command [netdef-compose](../netdef-compose/README.md) allows choosing 5G implementations for Control Plane (CP), User Plane (UP), and Radio Access Network (RAN) independently.
However, due to incompatibilities in 5G implementations, only a subset of combinations will work.
This page lists interoperability information between the implementations.

## CP-UP

Known to be compatible:

* `--cp=free5gc --up=free5gc`
* `--cp=free5gc --up=ndndpdk`
* `--cp=oai --up=ndndpdk`
* `--cp=oai --up=oai-vpp`
* `--cp=oai --up=oai`
* `--cp=open5gs --up=open5gs`
* `--cp=phoenix --up=ndndpdk`
* `--cp=phoenix --up=phoenix`

Known to be incompatible:

* `--cp=free5gc --up=oai`: [free5GC SMF issue 137](https://github.com/free5gc/smf/issues/137)
* `--cp=oai --up=free5gc` with `--oai-cn5g-nrf=false`: [free5GC UPF issue 65](https://github.com/free5gc/go-upf/issues/65)
* `--cp=oai --up=free5gc` with `--oai-cn5g-nrf=true`: SMF expects UPF to register itself in NRF, but UPF doesn't do that
* `--cp=open5gs --up=free5gc`: [free5GC UPF PR 66](https://github.com/free5gc/go-upf/pull/66)
* `--cp=open5gs --up=oai`: UPF does not support GTP-U Extension Header Deletion field (octet 6) in Outer Header Removal IE
* `--cp=phoenix --up=free5gc`: [free5GC UPF issue 63](https://github.com/free5gc/go-upf/issues/63)
* `--cp=phoenix --up=oai`: UPF cannot recognize CreateBAR IE in PFCP Session Establishment Request

## CP-RAN

Known to be compatible:

* `--cp=free5gc --ran=gnbsim`
* `--cp=free5gc --ran=packetrusher`
* `--cp=free5gc --ran=srsran`
* `--cp=free5gc --ran=ueransim`
* `--cp=oai --ran=gnbsim`
* `--cp=oai --ran=oai`
* `--cp=oai --ran=packetrusher`
* `--cp=oai --ran=ueransim`
* `--cp=open5gs --ran=oai`
* `--cp=open5gs --ran=packetrusher`
* `--cp=open5gs --ran=srsran`
* `--cp=open5gs --ran=ueransim`
* `--cp=phoenix --ran=packetrusher`
* `--cp=phoenix --ran=phoenix`
* `--cp=phoenix --ran=srsran`
* `--cp=phoenix --ran=ueransim`

Known to be incompatible:

* `--cp=free5gc --ran=oai`: [openairinterface5g issue 881](https://gitlab.eurecom.fr/oai/openairinterface5g/-/issues/881)

## UP-RAN

Known to be compatible:

* `--up=free5gc --ran=gnbsim`
* `--up=free5gc --ran=packetrusher`
* `--up=free5gc --ran=srsran`
* `--up=free5gc --ran=ueransim`
* `--up=ndndpdk --ran=phoenix`
* `--up=ndndpdk --ran=ueransim`
* `--up=oai --ran=gnbsim`
* `--up=oai --ran=oai`
* `--up=oai --ran=ueransim`
* `--up=oai-vpp --ran=oai`
* `--up=oai-vpp --ran=packetrusher`
* `--up=oai-vpp --ran=ueransim`
* `--up=open5gs --ran=oai`
* `--up=open5gs --ran=packetrusher`
* `--up=open5gs --ran=srsran`
* `--up=open5gs --ran=ueransim`
* `--up=phoenix --ran=packetrusher` with `--phoenix-upf-xdp=false`
* `--up=phoenix --ran=phoenix`
* `--up=phoenix --ran=srsran`
* `--up=phoenix --ran=ueransim`

Known to be incompatible:

* `--up=phoenix --ran=packetrusher` with `--phoenix-upf-xdp=true`: uplink GTPv1U header has sequence number field that is not accepted by UPF
