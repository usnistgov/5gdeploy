# 5gdeploy/scenario

Package **scenario** contains a collection of concrete scenarios.
Each scenario has a `scenario.ts` script that prints a [NetDef](../netdef) object, which can be passed to [netdef-compose](../netdef-compose) command to generate a Compose context.

## Scenario List

This package currently contains these scenarios:

* [20230510](20230510): cloud and edges
* [20230817](20230817): phones and vehicles, 3-slice with 3 UPFs
* [20231017](20231017): phones and vehicles, 2-slice with 2 UPFs
* [20231214](20231214): phones and vehicles, 2-slice with 1 UPF
* [20240129](20240129): many slices

Each scenario has a README that describes its parameters and specific usage instructions.
These instructions are in addition to the general description and instructions in the rest of this page.

Note: in later sections, `20230601` is a placeholder of a scenario identifier.
You should replace it with a concrete scenario identifier before running a sample command.

## Generating a Compose Context

Generating a Compose context from a scenario consists of two steps:

1. The scenario script (`scenario.ts`) prints a [NetDef](../netdef) JSON document that defines all aspects of the 5G network.
2. [netdef-compose](../netdef-compose) command converts the NetDef JSON document to a Compose context.

In most cases, you can use the [`generate.sh`](generate.sh) script to execute both steps successively.
It writes the output Compose context in `~/compose/20230601`, after deleting any prior contents in the output directory.
You can find the NetDef JSON document in `netdef.json` within that folder.

```bash
cd ~/5gdeploy/scenario
./generate.sh 20230601
```

Most `scenario.ts` scripts, as well as the netdef-compose command, can accept command line flags.
Typically,

* `scenario.ts` flags affect the topology and structure of a 5G network.
  * Examples include: number of UEs, connections between gNBs and UPFs.
  * More information can be found in the README of each scenario.
* netdef-compose flags affect the physical deployment of the network.
  * Examples include: CPU isolation, VXLAN bridges.
  * More information can be found on [netdef-compose README](../netdef-compose/README.md).

When calling `generate.sh`, you can specify command line flags to both scripts.
You must write `scenario.ts` flags first, changing the `--` prefix of each flag to `+`.
After these, you can write netdef-compose flags.

```bash
# CORRECT: pass "+gnbs=2" to scenario.ts, pass "--up=free5gc" to netdef-compose
./generate.sh 20230601 +gnbs=2 --up=free5gc

# WRONG: "+gnbs=2" is a scenario.ts flag but it has wrong "--" prefix
./generate.sh 20230601 --gnbs=2 --up=free5gc

# WRONG: scenario.ts flags are written after netdef-compose flags
./generate.sh 20230601 --up=free5gc +gnbs=2
```

You can obtain command line help information with:

```bash
./generate.sh --help
./generate.sh 20230601 --help
```

## Interacting with a Compose Context

After you have generated a Compose context, you can use these commands to interact with it.
Additional commands may be described in the README of each scenario.

```bash
# start a scenario
cd ~/compose/20230601
./compose.sh up
# You may only run one scenario at a time. Shutdown other scenarios before starting one.
# Generally a scenario takes 30~60 seconds to start and stabilize, please be patient.

# start a scenario with traffic capture
cd ~/compose/20230601
./compose.sh create
dumpcap -i br-cp -i br-n2 -i br-n3 -w ~/1.pcapng  # run this in another console
./compose.sh up

# list running containers
docker ps -a
# Seeing any "Exited" container indicates an error. Investigate by viewing container logs.

# view container logs
docker logs -f amf

# save container logs
docker logs amf >& amf.log
# If you ask for help regarding a container, attach this log file, do not send screenshots.

# stop a scenario
cd ~/compose/20230601
./compose.sh down
```

If you are using Open5GCore RAN simulators in the scenario, the UEs will not register automatically.
You can use [phoenix-rpc command](../phoenix-rpc) to register UEs and establish PDU sessions as defined in their configurations:

```bash
cd ~/5gdeploy
for UECT in $(docker ps --format='{{.Names}}' | grep '^ue'); do
  corepack pnpm -s phoenix-rpc --host=$UECT ue-register --dnn='*'
done
# note: In multi-host deployment, this only works for UEs running on the primary host. If some UEs
# are placed on secondary hosts, you'll need to install 5gdeploy on each secondary host and run
# this command from there.
```
