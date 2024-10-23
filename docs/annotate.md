# Compose Service Annotations

5gdeploy assigns [annotations](https://docs.docker.com/reference/compose-file/services/#annotations) on Compose services, to convey information among different scripts.
Each annotation name starts with `5gdeploy.` and is by a one word token.
They are typically accessed through `compose.annotate()` function.

This page lists the annotations used throughout the codebase.

## Network Definition

**dn** denotes a Data Network container.
Its value is S-NSSAI (hexadecimal) + "_" + DNN.

**ue\_supi** denotes a UE container that has one or more UEs.
Its value is a sequence of SUPIs separated by commas.
This annotation should appear on a container that has both gNB and UE functionality such as PacketRusher.

## IP Allocator

**ip\_***net* contains the IPv4 address for *net* network interface.
Its value is same as `.networks[net].ipv4_address`.
This survives even if the `.networks[net]` field is deleted by `compose/bridge.ts` when defining an Ethernet bridge.

**mac\_***net* contains the MAC address for *net* network interface.
The default MAC address is derived from the IP address by `compose.ip2mac()` function.
This annotation is added when a different MAC address is defined as part of an Ethernet bridge.

## Prometheus

**prometheus\_target** indicates the container is a Prometheus scrape target.
Its value is an URI, where the host+path is the scrape target, `job_name` query parameter is the job name, `labels` query parameter is a list of labels.

## Host Placement and CPU Isolation Request

The following annotations are added by code that defines network function containers.
They serve as inputs to `compose/place.ts` that determines how containers are placed onto hosts and assigned CPU cores.

**cpus** indicates how many dedicated CPU cores are needed by the network function.
Its value is an integer of CPU core quantity.
"0" means the container does not need dedicate CPU cores and should only be assigned with shared CPU cores.

**every\_host** indicates the container should run on every host, instead of being placed onto only one host.
Its value is "1".

**only\_if\_needed** indicates the container should not be explicitly placed on any host or started by `compose.sh`, but is only activated through dependencies.
Its value is "1".

## Host Placement and CPU Isolation Result

The following annotations are added by `compose/place.ts` when it places containers onto hosts and assigns them with CPU cores.
They are outputs of `compose/place.ts` and may be used by other scripts to understand how network functions have been placed.

**host** denotes the host machine IP address and SSH port number.
Empty string means the container is placed on the primary host.

**cpuset\_warning** indicates the container has requested dedicated CPU cores but the request cannot be fulfilled.
Its value is a warning message.

## Virtualization

**vmname** indicates the virtual machine name.
This may appear both in virtualization Compose file for the VM-related containers, and in scenario Compose file for containers placed on VMs.

## Client-Server Traffic Generator

The following annotations can only appear in the output Compose file of `trafficgen/tgcs.ts` script.

**tgcs\_tgid** denotes the traffic generator identifier.
Its value may be "iperf3", "owamp", etc.

**tgcs\_group** denotes a traffic generator group.
Its value is tgid + "_" + integer index number.

**tgcs\_dn** denotes the Data Network carrying the traffic flow.
Its value has the same syntax as `dn` annotation.

**tgcs\_ue** denotes the UE of the traffic flow.
Its value is an SUPI.

**tgcs\_dir** denotes the traffic direction.
Its value is one of `DL>`, `<UL`, `<->`.

**tgcs\_port** denotes the port number for the traffic flow.
If the traffic generator requires multiple ports, this is the lowest port number.
If the traffic generator uses no ports (e.g. ndnping), this value is purely nominal.

**tgcs\_stats\_ext** is the file extension of saved container logs.
Default is ".log".

**tgcs\_docker\_timestamps** indicates that the traffic generator does not print timestamps, so that Docker Engine timestamps should be added.
