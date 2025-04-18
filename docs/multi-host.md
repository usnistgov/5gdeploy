# Multi-Host Deployment

5gdeploy supports deploying a scenario over multiple host machines.
This allows a scenario to scale up and make use of more hardware resources than what a single host offers, and provides complete isolation between groups of network functions.
Most scenarios are compatible with multi-host deployment, with some scenarios strongly recommending multi-host deployment.
The README of each scenario typically contains information on how a scenario can be deployed over multiple hosts.
This page explains the basics of how multi-host deployment works and the command line flags that configure this feature.

## Primary and Secondary Hosts

In a multi-host deployment, one host is designated as *primary* and all other hosts are designated as *secondary*.
Unless otherwise noted, all 5gdeploy scripts and commands should be executed on the *primary* host.

Both the *primary* host and the *secondary* hosts can run network functions.
There's no restriction on where a network function may run.
The *primary* designation is only relevant to where to invoke (most of) the commands.

Many commands, despited being invoked on the *primary* host, need to perform actions on multiple hosts, such as starting containers.
These commands would internally connect to *secondary* hosts via SSH to perform these actions.
The [installation guide](INSTALL.md) "secondary host" section explains how to setup SSH keys to enable such control.

## How Multi-Host Deployment Works

The [netdef-compose](../netdef-compose/README.md) command supports multi-host deployment.
It generates a Compose context with multi-host deployment with these steps:

1. The 5G network, defined in either [NetDef](../netdef/README.md) format, is initially converted to a Compose context for single-host deployment.

    * This Compose file defines what network functions (i.e. containers) should be running, how they are connected to each other via Docker networks, and the IP address of each network interface.
    * You can view this Compose file if you do not specify any command line flags for multi-host deployment.
      Viewing the single-host Compose file is an important step in understanding how the scenario works and for designing the multi-host deployment.

2. If `--use-vm` command line flag is present, 5gdeploy loads a [virtualization Compose context](../virt/README.md).

    * Typical usage is `--use-vm=$HOME/compose/virt`.
    * It allows `--bridge` and `--place` command line flags to refer to virtual machines, but otherwise does not change the logic.
    * KVM guests must be running and ready for SSH connections, before generating/starting the scenario.

3. 5gdeploy processes the `--bridge` command line flags, which allow network functions on different hosts to communicate with each other.

    * If two network functions that need to communicate with each other would be running on separate hosts, you must specify a bridge to facilitate such communication.
      Otherwise, when they are placed onto different hosts, they cannot reach each other, and the 5G network will not work.
    * You can identify which network functions belong to the same Docker network by reading the single-host Compose file.
    * Establishing bridges should not change the logical network topology or IP address assignments in any way.

4. 5gdeploy processes the `--place` command line flags, which specify where to run each network function.

    * Using pattern matches, every network function (i.e. container) is placed on exactly one host.
    * The `5gdeploy.host` annotation in the Compose file indicates where a network function is being placed.

5. 5gdeploy processes CPU isolation instructions in `--place` command line flags, too.

6. The output is written as an annotated Compose file and a `compose.sh` script.

    * In the Compose file, each network function is annotated with host and CPU core assignments.
    * The `compose.sh` allows starting and stopping the Compose context at both *primary* and *secondary* hosts, invoked from the *primary* host.

## Bridges

Defining a bridge allows network functions in different hosts to communicate with each other.

5gdeploy supports two kinds of bridges:

* The **VXLAN** bridge interconnects Docker networks of the same name across multiple hosts.
  * A Docker network is created on each host that has one or more containers attached to it.
  * Containers on each host are still attached to the Docker network, in the same way as a single-host deployment.
  * VXLAN tunnels are established to interconnect the Docker networks from multiple hosts, so that packets sent from a container on one host could reach another container attached to a Docker network with the same name on another host.
* The **Ethernet** bridge replaces the Docker network with an external physical switch.
  * The Docker network is deleted from the Compose file and would not be created on each host.
  * Each container previously on the Docker network is given either a physical Ethernet adapter or a MACVLAN sub-interface, with its own MAC address.
  * Each physical Ethernet adapter involved in an Ethernet bridge must be connected to an external physical switch.

You can mix-and-match both kinds of bridges, for different Docker networks.

5gdeploy generates a bridge configuration script as `bridge.sh`.
It is executed in the `bridge` container on every host, in the host network namespace.

The `compose.sh` script would ensure:

* The `bridge` container is started on every host machine.
* Each network function container is started on exactly one host machine.

If you want to start the containers manually, you must ensure the same condition.
The bridge configuration script would wait for other containers and physical Ethernet adapters to appear, and then configure the bridges.

![bridge sample](multi-host.svg)

The `--bridge` flag creates a bridge.
Each flag value consists of three parts, separated by `|` character:

1. A network name, such as "n3".
2. Bridge mode, either "vx" or "eth".
3. Mode-specific parameters, separated by whitespaces.

### VXLAN Bridge

`--bridge='NETWORK | vx | IP0,IP1,...'` creates a VXLAN bridge for Docker network *NETWORK*, over host IP addresses *IP0*, *IP1*, etc.
In the example diagram, there are two VXLAN bridges for N2 and N4 networks, shown in fuchsia.
They can be created with command line flags like this:

```text
--bridge='n2 | vx | 192.168.62.1,192.168.62.2'
--bridge='n4 | vx | 192.168.64.1,192.168.64.3'
```

Notably, each bridge command lists two IPv4 addresses, one for each host participating in the bridge, regardless of how many network functions on a host would attach to the Docker network.
Prior to starting the scenario, you must manually configure the IP addresses onto host network interfaces and bring up those interfaces.
In the IP firewall, you should allow UDP port 4789 for VXLAN communication.
If you are using VMware virtual machines, it is advised to change TX offload settings on the network interfaces used by tunnel endpoints:

```bash
sudo ethtool --offload ens160 tx-checksum-ip-generic off
```

Bridge configuration scripts will setup VXLAN bridges, such that identically named Docker networks on different hosts are connected with each other.
This is achieved by creating a VXLAN tunnel between the first host and each subsequent host, and then adding these VXLAN tunnels to the bridges representing the specified Docker network.
If there are more than two hosts in a VXLAN bridge, the first host serves as a virtual root switch and all traffic goes through it, including traffic flows between second and third hosts.
This does not change the L3 network topology in any way, but can have performance implications.

Formally, in the mode-specific parameters field, each parameter is an *IP set* that contains two or more comma-delimited IPv4 addresses.
The first IP address in each IP set has a tunnel to each subsequent IP address.
If a virtualization Compose context was loaded through `--use-vm` flag, the command can accept two additional syntaxes:

* `ctrlif`: use host netif `vmctrl` of the primary host.
* `vm-`*vmname*: use KVM guest *vmname*, guest netif `vmctrl`, which must be in MACVTAP mode.

This allows creating a bridge that spans both physical hosts and KVM guests:

```text
--bridge='mgmt | vx | 192.168.60.1,192.168.60.2 ctrlif,vm-upf0,vm-upf1'
```

### Physical Ethernet Ports

`--bridge='NETWORK | eth | NF0=MAC0 NF1@MAC1 ...'` binds physical Ethernet ports to the containers.
It replaces a Docker network with a "physical" network connected to an external Ethernet switch, which could apply QoS and other policies.
In the example diagram, there are one Ethernet bridge for N3 networks, shown in yellow.
It can be created with command line flags like this:

```text
--bridge='n3 | eth |
  gnb0=02:00:00:03:00:10
  gnb1=02:00:00:03:00:11
  upf0=02:00:00:03:00:20+vlan3+rss0/2s
  upf1=02:00:00:03:00:21+vlan3+rss2/2s
'
```

In the mode-specific parameters field, each parameter consists of:

1. A [minimatch](https://www.npmjs.com/package/minimatch)-compatible pattern that selects containers attached to the Docker network.
   The patterns from all parameters must collectively match all containers originally attached to the Docker network.
2. An operator symbol, explained below.
3. One or more host interface MAC addresses.
4. VLAN ID (optional).
5. Receive Side Scaling setting (optional).

The operator indicates what kind of network interface is put into the container:

* The `=` operator moves the host interface into the container.
  * Typically, the pattern should match exactly one container and there is exactly one MAC address.
  * The quantity of containers matched by the pattern must be less than or equal to the quantity of MAC addresses.
    * These host interfaces are sequentially assigned to matched containers; any extras are unused.
    * This offers the convenience of writing assigning multiple host interfaces to multiple containers in similar roles.
  * The interface becomes inaccessible from the host and cannot be shared among multiple containers.
  * The original MAC address is adopted by the container.
* The `@` operator creates a MACVLAN subinterface on the host interface.
  * The pattern may match one or more containers.
  * There must be exactly one host interface MAC address.
  * The host interface remains accessible on the host.
  * Multiple containers may share the same host interface, where each container gets a random MAC address.
  * Currently this uses MACVLAN "bridge" mode, so that traffic between two containers on the same host interface is switched internally in the Ethernet adapter and does not appear on the external Ethernet switch.
  * This does not work if the host interface is itself a PCI Virtual Function that allows only one MAC address.
* The `~` operator records the MAC address of a container interface, but does not create the interface.
  * The pattern must match exactly one container.
  * There must be exactly one MAC address.
  * This is only usable in [NDN-DPDK UPF](../ndndpdk/README.md) configured with an Ethernet adapter using PCI driver.

If a virtualization Compose context was loaded through `--use-vm` flag, the host interface MAC address portion can accept two additional syntaxes:

* `vm-`*vmname*`:`*guestnetif*
  * Use KVM guest *vmname*, guest netif *guestnetif*, which must be in MACVTAP mode.
  * This only works with `=` operator, because a MACVTAP subinterface does not allow additional MAC addresses.
  * If multiple containers in a KVM guest need to use the same netif, you can create multiple guest netifs attached to the same physical host netif, and then assign one guest netif to each container.
* `vm-`*vmname*
  * Same as above, using network name (e.g. `n3`) as guest netif name.

Bridge configuration scripts will locate the host interface and invoke [pipework](https://github.com/jpetazzo/pipework) to make the move.
The specified host interface MAC address must exist on the host machine where you start the relevant network function.
Otherwise, pipework will fail with error message "no host interface matched".

#### VLAN ID

VLAN ID should be written as "+vlan" followed by an integer between 1 and 4094.
When VLAN ID is specified, the host interface name should be no longer than 10 characters.
pipework will append VLAN ID after the host interface name to form the VLAN interface name, which cannot exceed 15 characters.
If this is violated, iproute2 will fail with error message "name not a valid ifname".

Per initial testing, when VLAN ID is specified:

* With `=` operator, each hostif + VLAN ID combination can only be used with a single container.
* With `@` operator, pipework completes but the containers cannot communicate.
* VLAN ID with KVM guest is untested.

#### Receive Side Scaling

Receive Side Scaling setting is only allowed with `=` operator.
It consists of:

1. "+rss" string.
2. Start queue number *S*.
3. "/" symbol.
4. Queue quantity *E*, one of: 1, 2, 4, 8, 16.
5. RSS hash input mode, one of: "s" - source IPv4 address, "d" - destination IPv4 address, "f" - source TCP/UDP port, "n" - destination TCP/UDP port.

Bridge configuration scripts will configure Toeplitz hash function on the network interface so that RX packets are distributed into the *E* queues starting from queue-*S*.
The hash key is selected such that any *E* consecutive source/destination IP addresses are distributed to *E* distinct queues.
For example, assuming gNBs / UPFs / PDU sessions are assigned consecutive IP addresses, a possible arrangement to achieve balanced distribution is:

* UPF N3 could have +rss*S*/*E*s, where *E* is a divisor of gNB quantity.
* DN N6 could have +rss*S*/*E*s, where *E* is a divisor of per-DN UE quantity.
* UPF N6 could have +rss*S*/*E*d, where *E* is a divisor of per-DN UE quantity.
* gNB N3 could have +rss*S*/*E*s, where *E* is a divisor of UPF quantity.

Host NICs are not configured automatically, but they can be manually configured using the `toeplitz.sh` script embedded in the bridge container.
Note that changing RSS setting on a host NIC would affect all attached MACVLAN subinterfaces.
The same script supports changing container NIC RSS rules at runtime, as an alternative of writing "+rss" as part of bridge parameter.

For i40e (Physical Function) Ethernet adapter used inside KVM guest via PCI passthrough, the mapping between queue number and CPU core may change during virtual machine reboots.
This causes difficulty in providing a queue number in the *S* parameter when it's desired to handle the traffic in a specific CPU core.
To solve this issue, the `toeplitz.sh` script allows *S* parameter to be written as i40e:*C*, where *C* is a CPU core.
This would invoke `i40e-queue-cpu.sh` script to search for a queue number among `/proc/irq/*/effective_affinity_list`.
This syntax is only supported when invoking `toeplitz.sh` script manually, and *E* must be 1.

```bash
#                             netif S E input
docker exec bridge toeplitz.sh eth1 4 4 s
docker exec bridge toeplitz.sh eth2 6 2 d

#                             ct:netif S E input
docker exec bridge toeplitz.sh upf1:n3 8 2 s

# i40e lookup queue number by CPU core
$(./compose.sh at upf1) exec bridge toeplitz.sh upf1:n3 i40e:4 1 s

# revert to default state
docker exec bridge toeplitz.sh eth1    reset
docker exec bridge toeplitz.sh upf1:n3 reset
```

## Placement

By default, if you simply run `docker compose up -d`, all network functions are started on the primary host.
`--place=PATTERN@HOST` moves network functions matching pattern *PATTERN* to the Docker host *HOST*.
In the example diagram, gNBs and UEs are placed on *ran* host, UPFs and Data Networks are placed on *dn* host, everything else are placed on the *primary* host.
These can be specified with command line flags like this:

```text
--place="+(gnb*|ue*)@192.168.60.2"
--place="+(upf*|dn*)@192.168.60.3"
```

The patterns should be written in [minimatch](https://www.npmjs.com/package/minimatch)-compatible syntax.
They are matched in the order they are specified.
If a container name does not match any pattern, it stays on the primary host.
The `bridge` container will always run on every host.

The *HOST* portion has one of these forms:

* IPv4 address, which should accept SSH connections on port 22.
* A string identifier that is further resolved with `--ssh-uri` flag.
  * Example: `--place="+(gnb*|ue*)@ran" --ssh-uri="ran = root@192.168.60.3:2222"`
  * This is the only way to specify alternate SSH username and port number.
* `vm-`*vmname*, if a virtualization Compose context has been loaded through `--use-vm` flag.
  * Internally, this is realized by defining `--ssh-uri` flags.

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

## CPU Isolation

CPU isolation is configurable as part of `--place` flags.
`--place=PATTERN@HOST(CPUSET)` allocates CPU cores in *CPUSET* on *HOST* to network functions matching pattern *PATTERN*.
To allocate CPU cores on the primary host, omit the *HOST* portion and write `--place=PATTERN@(CPUSET)` only.
Example:

```text
--place="+(gnb*|ue*)@192.168.60.2(4,8-13)"
--place="upf*@192.168.60.3(4-7)"
--place="dn*@192.168.60.3(8-11)"
--place="*@(16-31)"
```

Each network function can request a specific quantity of dedicated cores.
The requested quantities are coded when integrating a 5G implementation, with some being configurable via advanced options (e.g. `--oai-upf-workers`) and others non-configurable.
They can be seen within `5gdeploy.cpus` annotation in the output Compose file.
The annotation by itself has no effect; it is only useful when the network function is matched by a `--place` flag pattern that has a cpuset.

CPU assignment is performed for each `--place` flag separately: the CPU cores in the cpuset are assigned to the group of network functions selected by the pattern.
When every network function matched in a `--place` flag is requesting dedicated cores and there are sufficient number of cores to satisfy all these requests, they will all receive dedicated cores.
If some network functions are not requesting dedicated cores, or if there aren't enough cores to satisfy all requests:

1. The first two cores in the cpuset are designated as *shared*, and all others are dedicated.
2. Requests for dedicated cores are satisfied as much as possible.
3. Network functions that do not request dedicated cores will receive the two *shared* cores.
4. Network functions that request dedicated cores but cannot be satisfied will also receive the same two *shared* cores.
   They will also gain a `5gdeploy.cpuset_warning` annotation to indicate this condition.
   If you find `5gdeploy.cpuset_warning` annotation in the Compose file, consider including more cores in the cpuset or placing network functions differently, to ensure predictable performance.

You can see a quick report of host placement and cpuset with this command:

```bash
~/5gdeploy/compose/place-report.sh compose.yml
```
