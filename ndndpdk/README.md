# 5gdeploy/ndndpdk

Package **ndndpdk** integrates [NDN-DPDK](https://github.com/usnistgov/ndn-dpdk) as a UPF implementation.
This package offers these choices in the **netdef-compose** command:

* `--up=ndndpdk`: [CN5G UPF](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf)

## NDN-UPF

NDN-DPDK has preliminary support for running as a 5G UPF, capable of carrying NDN traffic only.
The UPF terminates GTPv1U tunnels of IPv4 PDU sessions, where each PDU session is a face in the NDN-DPDK forwarder.
UEs can then send/receive NDN packets, encapsulated in IPv4 and UDP, through the PDU sessions.

Typically, you can designate one Data Network for NDN traffic, and keep other Data Networks for IP traffic.
Specify `--up=UPF-NAME=ndndpdk` flag to select NDN-DPDK for the UPF serving the NDN Data Network.
Then, specify a general `--up` flag after this flag to select a different UPF implementation for other UPFs.
For example: `--up=upf6=ndndpdk --up=free5gc`.

The NDN UPF requires two containers: NDN-DPDK service (`ndndpdk-svc`), NDN-UPF service (`ndndpdk-upf`).
5gdeploy only defines a container for the NDN-UPF service.
The entrypoint script of this container performs these steps:

1. Wait for N4, N3, N6 netifs to become ready.
2. Wait for NDN-DPDK forwarder to become ready and have an EthDev on the N3 netif.
3. Launch the `ndndpdk-upf` process.

For step 2 to succeed, you must manually perform these steps:

1. Launch a separate NDN-DPDK service container, attached to the netns of the UPF service container (i.e. `--network container:upf6`).
2. Activate NDN-DPDK service as a forwarder.
3. Create an EthDev on the N3 netif.

Once these steps are completed, the UPF would launch itself and respond to PFCP commands from the SMF.
When SMF instructs the UPF to establish/release a GTPv1U tunnel, the UPF would create/destroy a face in the NDN-DPDK forwarder.
Currently there's no way to modify FIB entries, which means the UE can only act as consumers.
