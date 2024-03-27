# 5gdeploy/trafficgen

Package **trafficgen** contains scripts that help preparing traffic generation and analyzing traffic statistics.
These scripts are integrated into [netdef-compose](../netdef-compose/README.md) command.
They can be invoked in a Compose context directory (e.g. `~/compose/20230601`), after the UEs have been registered and the PDU sessions have been established.

## List PDU Sessions

`./compose.sh list-pdu` command prints a TSV document that lists all established PDU sessions.
The information is gathered by executing `ip addr show` in each UE container, and then matching the interface IP addresses against UE subnets defined for Data Networks.
If a UE container runs multiple UEs (e.g. UERANSIM), the report would be imprecise because this command cannot identify which UE owns each IP address.

## nmap

`./compose.sh nmap` performs nmap ping scans from Data Network to determine how many UEs are reachable.
`--dnn` flag, specified as a [minimatch](https://www.npmjs.com/package/minimatch) pattern, selects which Data Network(s) to scan.
The scanned subnet size for each Data Network is adjusted to cover all online UEs.
`--cmdout` flag saves the commands to a file instead of executing.

```bash
# scan all Data Networks
./compose.sh nmap

# scan specific Data Networks
./compose.sh nmap --dnn='internet'

# print commands instead of executing
./compose.sh nmap --cmdout=-

# save commands to file instead of executing
./compose.sh nmap --cmdout=nmap.sh
```

## iperf3

`./compose.sh iperf3` performs throughput measurement using [iperf3](https://software.es.net/iperf/).

First, prepare iperf3 flows:

```bash
./compose.sh iperf3 --flow='* | * | -t 60 -u -b 10M' --flow='* | * | -t 60 -u -b 10M -R'
```

This script gathers information about currently connected PDU sessions and prepares an iperf3 flow for each PDU session between UE and Data Network.
The most important command line flag is `--flow` (repeatable).
Each `--flow` value consists of three parts, separated by `|` character:

1. a minimatch pattern that matches a Data Network Name (DNN)
2. a minimatch pattern that matches a UE SUPI
3. a sequence of iperf3 flags (passed to iperf3 client)

Each PDU session whose DNN and SUPI match the patterns would have an iperf3 flow with the specified flags.
Each `--flow` flag is processed separately, so that the same PDU session may match multiple flags and generate multiple iperf3 flows.

The command prints a brief report on the matched PDU sessions and iperf3 flows.
If there are fewer than expected iperf3 flows, please check that UEs are registered and PDU sessions have been established.

The output of this script includes:

* Compose file `compose.iperf3.yml`, which defines necessary iperf3 containers
* bash script `iperf3.sh`, which runs iperf3 containers and gathers statistics in JSON format

After generation, you can run the iperf3 flows and analyze its results as follows:

```bash
./iperf3.sh
```

This command runs the pipeline and prints statistics at last.
These statistics are also saved in `iperf3.tsv`.
The JSON outputs of each iperf3 container are saved in `~/compose/20230601/iperf3` directory.

### Subcommands of the bash Script

The bash script `iperf3.sh` has these subcommands:

```bash
# start servers and sleep 5 seconds
./iperf3.sh servers

# start clients
./iperf3.sh clients

# wait for clients to finish
./iperf3.sh wait

# gather container outputs
./iperf3.sh collect

# delete servers and clients
./iperf3.sh stop

# tally overall statistics
./iperf3.sh stats
```

If no parameter is specified, the script runs these steps sequentially.

### Multiple Measurement Sets

To prepare multiple sets of iperf3 measurements, add `--prefix` and `--port` flags.
The `--prefix` flag determines Compose filename, container names, bash script filename, stats directory name, etc.
The `--port` flag is the starting port number used by traffic generators, which should be non-overlapping.
For example:

```bash
./compose.sh iperf3 --prefix=iperf3internet --port=21000 --flow='internet | * | -t 60 -u -b 10M' --flow='internet | * | -t 60 -u -b 50M -R'
./iperf3internet.sh

./compose.sh iperf3 --prefix=iperf3vehicle --port=24000 --flow='vcam | * | -t 60 -u -b 20M' --flow='vctl | * | -t 60 -u -b 1M -R'
./iperf3vehicle.sh
```

Measurement sets prepared with distinct prefixes can be controlled independently.
Starting or stopping one set would not stop other sets or overwrite each other's files.

### Text Output

If you want iperf3 text output instead of JSON output, change `./compose.sh iperf3` to `./compose.sh iperf3t`.

```bash
./compose.sh iperf3t --flow='* | * | -t 60 -u -b 10M' --flow='* | * | -t 60 -u -b 10M -R'
./iperf3.sh
```

The text outputs of each iperf3 container are saved in `~/compose/20230601/iperf3t` directory, but the script cannot gather overall statistics.
