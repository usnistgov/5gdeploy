# netdef-compose

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

Due to differences in 5G protocol details, not every combinations are compatible with each other.
These combinations are verified to be compatible:

* `--cp=phoenix --up=phoenix --ran=phoenix`
* `--cp=phoenix --up=phoenix --ran=ueransim`
* `--cp=phoenix --up=phoenix --ran=oai`
* `--cp=phoenix --up=free5gc --ran=ueransim`
* `--cp=free5gc --up=free5gc --ran=ueransim`

## Multi-Host Usage

The `--bridge` flag allows splitting a scenario over multiple physical/virtual machines, with a subset of network functions placed on each machine.

Bridge configuration scripts are defined as the command line of a special `bridge` container.
You may view these commands with:

```bash
yq .services.bridge.command.2 compose.yml | sed 's/\$\$/$/g'
```

When using this feature, you should:

* Start the `bridge` container on every host machine.
* Start each of other containers on exactly one host machine.

### VXLAN Bridge

`--bridge=NETWORK,vx,IP0,IP1,...` creates a VXLAN bridge for Docker network *NETWORK*, over host IP addresses *IP0*, *IP1*, etc.
Example:

```text
--bridge=n2,vx,192.168.60.1,192.168.60.2,192.168.60.3
```

Generally, the list of IP addresses shall include every host machine used in the deployment.
In the IP firewall, you should allow UDP port 4789 for VXLAN communication.
If you are using VMware virtual machines, it is advised to change TX offload settings on the network interfaces used by tunnel endpoints:

```bash
sudo ethtool --offload ens160 tx-checksum-ip-generic off
```

Bridge configuration scripts will setup VXLAN bridges, so that Docker networks with the specified name on different hosts can reach each other.
This is achieved by creating a VXLAN tunnel between the first host and each subsequent host, and then adding these VXLAN tunnels to the bridges representing the specified Docker network.
The first host serves as a virtual root switch and all traffic goes through it, even if the traffic flow is between second and third hosts.
This does not change the L3 network topology in any way, but can have performance implications.

### Physical Ethernet Ports

`--bridge=NETWORK,eth,NF0=MAC0,NF1@MAC1,...` binds physical Ethernet ports to the containers.
It replaces a Docker network with a "physical" network connected to an external switch; QoS and other policies can be applied through the switch.
Example:

```text
--bridge=n3,eth,gnb0=02:00:00:03:00:10,upf1=02:00:00:03:00:21
```

The flag must list all containers originally attached to a Docker network.
The operator between a container name and a host interface MAC address could be either `=` or `@`:

* The `=` operator moves the host interface into the container.
  It becomes inaccessible from the host and cannot be shared among multiple containers.
  The original MAC address is adopted by the container.
* The `@` operator creates a MACVLAN subinterface on the host interface.
  The host interface remains accessible on the host.
  Multiple containers may share the same host interface; each container gets a random MAC address.
  Currently this uses MACVLAN "bridge" mode, so that traffic between two containers on the same host interface is switched internally in the Ethernet adapter and does not appear on the connected Ethernet switch.

Bridge configuration scripts will locate the host interface and invoke [pipework](https://github.com/jpetazzo/pipework) to make the move.
The specified host interface MAC address must exist on the host machine where you start the relevant network function, otherwise this procedure will fail.
