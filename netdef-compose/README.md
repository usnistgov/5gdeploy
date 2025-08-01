# 5gdeploy/netdef-compose

Command **netdef-compose** generates Compose file and config folder from a [network definition](../netdef).

## Basic Usage

View help:

```bash
corepack pnpm netdef-compose --help
```

Generate Compose file and config folder with default settings:

```bash
corepack pnpm netdef-compose --netdef=$HOME/netdef.json --out=$HOME/compose/example
```

## Choose 5G Implementations

You can choose Control Plane, User Plane, and Radio Access Network implementations independently.
Example command:

```bash
corepack pnpm netdef-compose --netdef=$HOME/netdef.json --out=$HOME/compose/example \
  --cp=open5gs --up=open5gs --ran=srsran
```

The default combination is `--cp=free5gc --up=free5gc --ran=ueransim` (subject to change).
These are some verified combinations, see [interoperability](../docs/interop.md) for more information:

* `--cp=free5gc --up=free5gc --ran=packetrusher`
* `--cp=free5gc --up=free5gc --ran=ueransim`
* `--cp=oai --up=oai --ran=oai`
* `--cp=open5gs --up=open5gs --ran=srsran`
* `--cp=phoenix --up=phoenix --ran=phoenix`

Each UPF implementation may be chosen independently, by repeating the `--up` flag.
Each flag value consists of a minimatch pattern followed by a 5G implementation identifier.
Example command:

```bash
corepack pnpm netdef-compose \
  --up='upf1=free5gc' --up='*=open5gs' \
  [other arguments]
```

### Disabling RAN

`--ran=none` flag disables the Radio Access Network simulators.
In this case, 5gdeploy will only provision the core network, ready for connections from physical gNBs.
You'll also need to [define SIM cards](../replace-sims/README.md) and [expose n2,n3 networks on physical Ethernet ports](../docs/multi-host.md) so they are reachable from gNBs.

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

You can deploy a scenario over multiple physical/virtual machines, with a subset of network functions placed on each machine, by specifying `--bridge` and `--place` command line flags.
See [multi-host deployment](../docs/multi-host.md) for more information.

## QoS and Network Emulation Settings

QoS rules can be applied to IPv4 packets transmitted by these network functions:

* free5GC: UPF
* Open5GCore: gNB, UPF
* PacketRusher: gNB
* UERANSIM: gNB

`--set-dscp` alters outer IPv4 DSCP field for traffic transmitted by a network function.
The syntax looks like `--set-dscp='n3 | gnb* | upf4 | 32'`, where each value contains four parts delimited by `|` symbol:

1. Network name, which must exist in the topology and connected to each matched source network function.
2. Minimatch pattern that matches the source network function container name.
3. Minimatch pattern that matches the destination network function container name.
4. DSCP value between 0 and 63 (written as decimal or hexadecimal).

`--set-netem` applies sch\_netem parameters for traffic transmitted by a network function.
The syntax looks like `--set-netem='n3 | gnb* | upf* | delay 10ms'`, where each value contains four parts delimited by `|` symbol:

1. Network name, which must exist in the topology and connected to each matched source network function.
2. Minimatch pattern that matches the source network function container name.
3. Minimatch pattern that matches the destination network function container name.
4. [tc-netem](https://man7.org/linux/man-pages/man8/tc-netem.8.html) command parameters.

Note: the spaces around `|` are optional but they must be consistent.
You can either have spaces around every `|` symbol (effectively `" | "` is the delimiter) or none of them.
The minimatch patterns can contain `|` symbol, only if the delimiter `|` symbols have spaces around them.

## Metrics Collection with Prometheus and Grafana

Unless disabled with `--prometheus=false` flag, the generated Compose file supports Prometheus metrics collection and Grafana visualization.
Run `./compose.sh web` in the Compose context folder to view access instructions.

Currently, scrape targets include:

* Open5GCore network functions
* Open5GS network functions
* eUPF
* process-exporter on each host machine
  * gathering stats of Open5GCore processes

When used in a multi-host deployment:

* Keep `prometheus` and `grafana` containers on the primary host.
* Do not create a bridge for `meas` network.
* Create bridges for all other networks joined by `prometheus` container.
* process-exporter shall be exposed on port 9256 of each host IP.
  If the same IP has multiple hosts (via `--ssh-uri` flag) or the port is blocked, this scrape target will not work.
