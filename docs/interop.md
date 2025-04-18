# Interoperability between 5G Implementations

Command [netdef-compose](../netdef-compose/README.md) allows choosing 5G implementations for Control Plane (CP), User Plane (UP), and Radio Access Network (RAN) independently.
However, due to incompatibilities in 5G implementations, only a subset of combinations will work.
This page lists interoperability information between the implementations.

## CP-UP

Known to be compatible:

* `--cp=free5gc --up=eupf`
* `--cp=free5gc --up=free5gc`
* `--cp=free5gc --up=ndndpdk`
* `--cp=oai --up=eupf`: must disable NRF with `--oai-cn5g-nrf=false`
* `--cp=oai --up=ndndpdk`
* `--cp=oai --up=oai-vpp`
* `--cp=oai --up=oai`
* `--cp=open5gs --up=eupf`
* `--cp=open5gs --up=open5gs`
* `--cp=phoenix --up=bess`
* `--cp=phoenix --up=ndndpdk`
* `--cp=phoenix --up=phoenix`

Known to be incompatible:

* `--cp=free5gc --up=bess`: [BESS-UPF issue 873](https://github.com/omec-project/upf/issues/873)
* `--cp=free5gc --up=oai`: [OAI-CN5G-UPF rejects CreateQER without Guaranteed Bitrate IE](https://lists.eurecom.fr/sympa/arc/openaircn-user/2025-03/msg00003.html)
* `--cp=free5gc --up=phoenix`: UPF does not support PDI with both F-TEID and UE IP Address
* `--cp=oai --up=free5gc` with `--oai-cn5g-nrf=false`: [free5GC UPF issue 65](https://github.com/free5gc/go-upf/issues/65)
* `--cp=oai --up=free5gc` with `--oai-cn5g-nrf=true`: SMF expects UPF to register itself in NRF, but UPF doesn't do that
* `--cp=open5gs --up=bess`: UPF does not support PDI with "Source Interface: CP-function"
* `--cp=open5gs --up=free5gc`: [free5GC issue 509](https://github.com/free5gc/free5gc/issues/509)
* `--cp=open5gs --up=oai`: UPF does not support GTP-U Extension Header Deletion field (octet 6) in Outer Header Removal IE
* `--cp=open5gs --up=phoenix`: UPF segfaults upon receiving PDI with "Source Interface: CP-function"
* `--cp=phoenix --up=free5gc`: [free5GC UPF issue 63](https://github.com/free5gc/go-upf/issues/63)
* `--cp=phoenix --up=oai`: UPF cannot recognize CreateBAR IE in PFCP Session Establishment Request

## CP-RAN

Known to be compatible:

* `--cp=free5gc --ran=gnbsim`
* `--cp=free5gc --ran=oai`
* `--cp=free5gc --ran=packetrusher`
* `--cp=free5gc --ran=srsran`
* `--cp=free5gc --ran=ueransim`
* `--cp=oai --ran=gnbsim`
* `--cp=oai --ran=oai`
* `--cp=oai --ran=packetrusher`
* `--cp=open5gs --ran=oai`
* `--cp=open5gs --ran=packetrusher`
* `--cp=open5gs --ran=srsran`
* `--cp=open5gs --ran=ueransim`
* `--cp=phoenix --ran=packetrusher`
* `--cp=phoenix --ran=phoenix`
* `--cp=phoenix --ran=srsran`

Known to be incompatible:

* `--cp=oai --ran=ueransim`: AMF cannot handle UserLocationInformation in NGAP PDUSessionResourceSetupResponse
* `--cp=phoenix --ran=ueransim`: AMF cannot handle UserLocationInformation in NGAP PDUSessionResourceSetupResponse

## UP-RAN

Known to be compatible:

* `--up=bess --ran=phoenix`
* `--up=eupf --ran=gnbsim`
* `--up=eupf --ran=oai`
* `--up=eupf --ran=packetrusher`
* `--up=eupf --ran=srsran`
* `--up=eupf --ran=ueransim`
* `--up=free5gc --ran=gnbsim`
* `--up=free5gc --ran=oai`
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
* `--up=phoenix --ran=packetrusher` with `--phoenix-upf-xdp=true`: must disable GTP-U sequence number with `--gtp5g-seq=false`
* `--up=phoenix --ran=phoenix`
* `--up=phoenix --ran=srsran`
