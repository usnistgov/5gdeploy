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

A scenario can be deployed over multiple physical/virtual machines, with a subset of network functions placed on each machine.
You may span a network bridge across host machines with `--bridge` flag and define network function placement with `--place` flag.

The `--bridge` flag(s) generates bridge configuration scripts.
They are defined as the command line of a special `bridge` container.
You may view these commands with:

```bash
yq .services.bridge.command.2 compose.yml | sed 's/\$\$/$/g'
```

When using bridge configuration scripts, you should:

* Start the `bridge` container on every host machine.
* Start each of other containers on exactly one host machine.

The `--place` flag(s) defines which host machine should run each network function.
They are generated into a `compose.sh` bash script.

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

Bridge configuration scripts will setup VXLAN bridges, such that identically named Docker networks on different hosts are connected with each other.
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

### Placement

By default, if you simply run `docker compose up -d`, all network functions are started on the primary host.
`--place=PATTERN@HOST` moves network functions matching pattern *PATTERN* to the Docker host *HOST*.
Example:

```text
--place="+(gnb*|ue*)@192.168.60.3" --place="upf*@192.168.60.4"
```

The patterns should be written in [minimatch](https://www.npmjs.com/package/minimatch)-compatible syntax.
They are matched in the order they are specified.
If a container name does not match any pattern, it stays on the primary host.
The `bridge` container will always run on every host.

It is your responsibility to ensure Docker networks that span multiple hosts have a bridge connecting them.
Otherwise, the 5G network probably will not work.

A `compose.sh` script is generated, which allows you to interact with the multi-host scenario:

```bash
# start the scenario on all hosts
./compose.sh up

# stop the scenario on all hosts
./compose.sh down

# execute a Docker command on the host machine of the specified network function
$(./compose.sh at CT) CMD
# example:
$(./compose.sh at ue1000) logs -f ue1000
# $(./compose.sh at CT) expands to either:
# - 'docker', if the named container is placed on the primary host
# - 'docker -H ssh://HOST', if the named container is placed on a secondary host
```

With `--place` flags, all containers are defined in a single Compose file but the `compose.sh` script will list each container name for the proper host machine.
You can add `--split` flag to generate a separate Compose file for each host machine, if you prefer that way.

### CPU Isolation

It is possible to configure CPU isolation as part of the `--place` flag.
`--place=PATTERN@HOST(CPUSET)` allocates CPU cores in *CPUSET* on *HOST* to network functions matching pattern *PATTERN*.
To allocate CPU cores on the primary host, omit the `HOST` part and write `--place=PATTERN@(CPUSET)` only.
Example:

```text
--place="+(gnb*|ue*)@192.168.60.3(4,8-13)" --place="upf*@192.168.60.4(4-7)" --place="*@(16-31)"
```

Each network function can request a specific quantity of dedicated cores, denoted as `5gdeploy.cpus` annotation.
When every network function matched in a `--place` flag is requesting dedicated cores and there are sufficient number of cores to satisfy all these requests, they will all receive dedicated cores.

If some network functions are not requesting dedicated cores, or if there aren't enough cores to satisfy all requests, the first two cores in the cpuset are designated as *shared*, and all others are dedicated.
Then, a subset of requests will be satisfied, others will receive the shared cores.
Containers that requested dedicated cores but are allocated shared cores will have `5gdeploy.cpuset_warning` annotation.
If you find this annotation is the Compose, consider revising the cpuset to include more cores.
