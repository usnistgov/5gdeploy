# 5gdeploy/ndndpdk

Package **ndndpdk** integrates [NDN-DPDK](https://github.com/usnistgov/ndn-dpdk) as a UPF implementation.
This package offers these choices in the **netdef-compose** command:

* `--up=ndndpdk`: NDN-DPDK UPF

5gdeploy does not build NDN-DPDK Docker images because compilation options are hardware dependent.
You must [build the `localhost/ndn-dpdk` container image](https://github.com/usnistgov/ndn-dpdk/blob/main/docs/Docker.md) and made it available on each UPF host.

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
3. If the N3 IPv4 address is not found within the container, create a pass-through face on the EthDev, and assign the N3 IPv4 address to the associated TAP netif.
   This enables the UPF to respond to ARP queries.
4. Launch the `ndndpdk-upf` process.

For step 2 to succeed, you must manually perform these steps:

1. Launch a separate NDN-DPDK service container, attached to the netns of the UPF service container (i.e. `--network container:upf6`).
2. If the EthDev on the N3 netif would be using rte\_mlx5 PCI driver, delete the IPv4 address on the N3 netif.
3. Activate NDN-DPDK service as a forwarder.
4. Create an EthDev on the N3 netif.

Once these steps are completed, the UPF would be launched and start responding to PFCP commands from the SMF.
When the SMF instructs the UPF to establish/release a GTPv1U tunnel, the UPF would create/destroy a face in the NDN-DPDK forwarder.
Currently there's no way to modify FIB entries, which means the UEs can only act as consumers.
