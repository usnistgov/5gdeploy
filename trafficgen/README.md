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

This script gathers information about currently connected PDU sessions and prepares an iperf3 test for each PDU session between UE and Data Network, where the iperf3 server shares a netns with the DN container and the iperf3 client shares a netns with the UE container.
The `--flow` flag is repeatable.
Each `--flow` value consists of three parts, separated by `|` character:

1. a minimatch pattern that matches a Data Network Name (DNN)
2. a minimatch pattern that matches a UE SUPI
3. a sequence of iperf3 client flags

Each PDU session whose DNN and SUPI match the patterns would have an iperf3 flow with the specified flags.
Each `--flow` flag is processed separately, so that the same PDU session may match multiple flags and generate multiple iperf3 flows.

The command prints a brief report on the matched PDU sessions and iperf3 flows.
If there are fewer than expected iperf3 flows, please check that UEs are registered and PDU sessions have been established.

The output of `./compose.sh iperf3` includes:

* Compose file `compose.iperf3.yml`, which defines necessary iperf3 containers
* bash script `iperf3.sh`, which runs iperf3 containers and saves statistics in `./iperf3` directory

### Subcommands of Generated bash Script

Normally, you can run `iperf3.sh` script without parameter, to execute all the steps:

```bash
./iperf3.sh
```

The script has these steps / subcommands:

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

### iperf3 Text Output

If you want iperf3 text output instead of JSON output, change `./compose.sh iperf3` to `./compose.sh iperf3t`.

```bash
./compose.sh iperf3t --flow='* | * | -t 60 -u -b 10M' --flow='* | * | -t 60 -u -b 10M -R'
./iperf3t.sh
```

The text outputs of each iperf3 container are saved in `./iperf3t` directory, but the script cannot gather overall statistics.

## OWAMP and TWAMP

`./compose.sh owamp` performs one-way latency measurement using [OWAMP](https://software.internet2.edu/owamp/).
`./compose.sh twamp` performs two-way latency measurement using [TWAMP](https://datatracker.ietf.org/doc/html/rfc5357).

```bash
./compose.sh owamp --flow='internet | * | -L 3.0 -s 900' --flow='vcam | * | -t' --flow='vctl | * | -f'
./owamp.sh

./compose.sh twamp --flow='internet | * | -L 3.0 -s 900 -v'
./twamp.sh
```

This script gathers information about currently connected PDU sessions and prepares an OWAMP/TWAMP test for each PDU session between UE and Data Network, where owampd/twampd shares a netns with the DN container and owping/twping shares a netns with the UE container.
The `--flow` flag is repeatable.
Each `--flow` value consists of three parts, separated by `|` character:

1. a minimatch pattern that matches a Data Network Name (DNN)
2. a minimatch pattern that matches a UE SUPI
3. (optional) a sequence of [owping](https://software.internet2.edu/owamp/owping.man.html) or twping flags

Similar to iperf3, you can specify `--prefix` and `--port` flags to define multiple measurement sets.

### Session File

You can pass flags to owping/twping within the third part of `--flow` flag.
`-F` and `-T` flags are handled specially: the filename that follows either flag is ignored; instead, it is set to a file in `~/compose/20230601/owamp` directory.

OWAMP session files can be further analyzed with `owstats` command.

```bash
./compose.sh owamp --port=21000 --flow='internet | *1000 | -F x -T x'
./owamp.sh

alias owstats='docker run --rm --mount type=bind,source=$(pwd),target=/data,readonly=true -w /data perfsonar/tools owstats'
owstats -R ./owamp/21000-F.owp
owstats -R ./owamp/21000-T.owp
```

There isn't a tool to analyze TWAMP session files.
To see the raw output, it's advised to pass either `-R` or `-v` flag to twping.
