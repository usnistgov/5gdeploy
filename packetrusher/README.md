# 5gdeploy/packetrusher

Package **packetrusher** generates [PacketRusher](https://github.com/HewlettPackard/PacketRusher) configuration.
This package offers these choices in the **netdef-compose** command:

* `--ran=packetrusher`

## GTP-U Tunnel Option

### `--prush-tunnel=true`

This choice (default) enables GTP-U tunnels that allow user traffic through the PDU sessions.

Constraints:

* There is exactly one NetDef subscriber connected to each gNB.
* Each subscriber must have a `.count` equal to 1.

Behavior:

* PacketRusher performs control plane procedures including UE registration and PDU session establishment.
* PacketRusher creates a GTP-U tunnel netif that allows user traffic through the PDU session.

When using this mode, PacketRusher depends on gtp5g kernel module.
See [free5GC README](../free5gc/README.md) for how to load this kernel module and how to recover from PacketRusher crash.

### `--prush-tunnel=false`

This choice disables GTP-U tunnels.

Constraints:

* There is exactly one NetDef subscriber connected to each gNB.
* Each subscriber may have a `.count` greater than 1, in which case multiple UEs with consecutive SUPIs would be defined.

Behavior:

* PacketRusher performs control plane signaling procedures including UE registration and PDU session establishment.
* It isn't possible to send user traffic through the PDU sessions.

## Multi gNB Option

### `--prush-multi=false`

This choice (default) creates one container for each gNB and its UEs.

Constraints:

* No additional constraint.

Behavior:

* There is one container for each gNB and its UEs.

### `--prush-multi=true`

This choice puts all gNBs and UEs in the same container.

Constraints:

* gNBs must have consecutive gNB IDs.
* Each subscriber must have a `.count` equal to 1.
* Subscribers must have consecutive SUPIs and same K/OPC values.

Behavior:

* There is one container for all gNBs and UEs.
* 1 gNB + 1 UE is automatically changed to 2 gNBs + 1 UE for handover scenarios.

## UE Single DN Option

PacketRusher can only connect to one Data Network from each UE.
If there are multiple Data Networks defined in the NetDef subscriber, you can choose a Data Network with one of these options:

* `--ue-single-dn=first` chooses the first Data Network.
* `--ue-single-dn=last` chooses the last Data Network.
* `--ue-single-dn=rotate` chooses a different Data Network from each consecutive UE.
  * This choice is ineffective when there are multiple UEs in the same container.

## Extra Flags Option

`--prush-extra` accepts a string of extra flags passed to PacketRusher multi-ue scenario.
Run this command to view available flags:

```bash
docker run --rm 5gdeploy.localhost/packetrusher multi-ue --help
```

Notes on specific flags:

* `--number-of-ues`, `--tunnel`, `--tunnel-vrf`, `--dedicatedGnb` must be omitted because they are derived from other 5gdeploy options.
* `--pcap` is unusable due to lack of volume mounts.
* `--timeBeforeNgapHandover`, `--timeBeforeXnHandover` are usable only with `--prush-multi=true`.
* `--numPduSessions` is at most 15.
* If `--prush-tunnel=true` is enabled, using `--timeBeforeDeregistration` and `--loop` together would cause a crash.

Examples:

```text
--prush-extra='--timeBeforeXnHandover=12000'
--prush-extra='--timeBeforeIdle=12000 --timeBeforeReconnecting=3000'
```
