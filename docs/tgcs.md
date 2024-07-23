# Client-Server Traffic Generators

Many traffic generators have a client-server architecture, including:

* iperf3
* OWAMP and TWAMP
* netperf
* sockperf

These traffic generators are supported through `./compose.sh tgcs` subcommand.
See [traffic generators](trafficgen.md) for other traffic generators.

## Basic Usage

`./compose.sh tgcs` defines a measurement set that runs one or more client-server traffic generators.

```bash
./compose.sh tgcs --prefix=PREFIX --port=PORT \
  --TGID='DN-PATTERN | UE-PATTERN | CLIENT-FLAGS | SERVER-FLAGS'
```

* `--prefix` flag specifies container name prefix and result folder name (optional, defaults to "tg").
* `--port` flag specifies the port number used by the first traffic generator (optional, defaults to 20000).
* Each traffic generator type has a distinct flag named after *TGID*, such as `--iperf3` or `--owamp`.
  These flags define the traffic flows for each traffic generator.

The traffic flow flags are repeatable.
Each flag value consists of four parts, separated by `|` character:

1. a [minimatch](https://www.npmjs.com/package/minimatch) pattern that matches a Data Network Name (DNN)
2. a minimatch pattern that matches a UE SUPI
3. a sequence of client flags
4. a sequence of server flags

The command gathers information about currently connected PDU sessions (same as `list-pdu` subcommand), matches the DNN and SUPI against the patterns in traffic flow flags, and defines a pair of client and server for each matched PDU sessions.
The client shares a netns with the UE container; the server shares a netns with the DN container.
Each traffic flow flag is processed separately, so that the same PDU session may match multiple flags and create multiple pairs of clients and servers.

![client-server traffic generators](tgcs.svg)

The command prints a brief report on the matched PDU sessions and traffic flows.
If there are fewer than expected traffic flows, please check that UEs are registered and PDU sessions have been established.

The output includes:

* Compose file `compose.PREFIX.yml`, which defines necessary traffic generator containers.
* bash script `PREFIX.sh`, which runs traffic generator containers and saves statistics in `~/compose/20230601/PREFIX` directory.
* TSV file `PREFIX.tsv`, which has the same information as the brief report.

## iperf3

`--iperf3` traffic flow flag prepares throughput measurement using [iperf3](https://software.es.net/iperf/).

```bash
./compose.sh tgcs --iperf3='* | * | -t 60 -u -b 10M' --iperf3='* | * | -t 60 -u -b 10M -R'
./tg.sh
```

Client flags are passed to iperf3 client.
Server flags are not accepted.

The JSON outputs of each iperf3 container are saved in `~/compose/20230601/PREFIX` directory.
The script shows a brief summary of iperf3 flows.

### iperf3 Text Output

If you want iperf3 text output instead of JSON output, use `--iperf3t` traffic flow flag in place of `--iperf3`.

```bash
./compose.sh tgcs --iperf3t='* | * | -t 60 -u -b 10M' --iperf3t='* | * | -t 60 -u -b 10M -R'
./tg.sh
```

The text outputs of each iperf3 container are saved in `~/compose/20230601/PREFIX` directory, but the script cannot gather overall statistics.

## OWAMP and TWAMP

`--owamp` traffic flow flag prepares one-way latency measurement using [OWAMP](https://software.internet2.edu/owamp/).
`--twamp` traffic flow flag prepares two-way latency measurement using [TWAMP](https://datatracker.ietf.org/doc/html/rfc5357).

```bash
./compose.sh tgcs --owamp='internet | * | -L 3.0 -s 900' --owamp='vcam | * | -t' --owamp='vctl | * | -f'
./tg.sh

./compose.sh tgcs --twamp='internet | * | -L 3.0 -s 900 -v'
./tg.sh
```

Client flags are passed to [owping](https://software.internet2.edu/owamp/owping.man.html) or twping.
Server flags are not accepted.

### Session File

You can pass flags to owping/twping within the third part of traffic flow flags.
`-F` and `-T` flags are handled specially: the filename that follows either flag is ignored.
Instead, it is set to a file in `~/compose/20230601/PREFIX` directory.

OWAMP session files can be further analyzed with `owstats` command.

```bash
./compose.sh tgcs --port=21000 --owamp='internet | *1000 | -F x -T x'
./tg.sh

alias owstats='docker run --rm --mount type=bind,source=$(pwd),target=/data,readonly=true -w /data perfsonar/tools owstats'
owstats -R ./tg/21000-F.owp
owstats -R ./tg/21000-T.owp
```

There isn't a tool to analyze TWAMP session files.
To see the raw output, it's advised to pass either `-R` or `-v` flag to twping.

## Netperf

`--netperf` traffic flow flag prepares a [netperf](https://hewlettpackard.github.io/netperf/doc/netperf.html) benchmark.

```bash
./compose.sh tgcs --netperf='internet | * | -t OMNI -j -- -T UDP -d send -o all'
./tg.sh
```

Client flags are passed to `netperf`.
Server flags are passed to `netserver`.

The script cannot identify the traffic direction of each flow in the brief report.
The script cannot gather summary information from the output.

## Sockperf

`--sockperf` traffic flow flag prepares a [sockperf](https://manpages.ubuntu.com/manpages/jammy/man1/sockperf.1.html) benchmark.

```bash
./compose.sh tgcs --sockperf='internet | * | under-load --full-log x --full-rtt -t 30 -m 800 -b 1 --reply-every 1 --mps 1000 | -g'
./tg.sh
```

Client flags, starting with a subcommand such as `under-load`, are passed to `sockperf`.
Server flags are passed to `sockperf server`.

Similar to OWAMP, the filename that follows `--full-log` is set to a file in `~/compose/20230601/PREFIX` directory, which can be analyzed later.

The script cannot gather summary information from the output.

## Advanced Usage

### Independent Measurement Sets

Normally, `./compose.sh tgcs` prepares a measurement set that contains one or more traffic generators of either same or different types.
Traffic generators within a measurement set are controlled together and executed in parallel.

If you want to prepare multiple measurement sets that can be controlled independently, add `--prefix` and `--port` flags to the command line.
The `--prefix` flag determines Compose filename, container names, bash script filename, stats directory name, etc.
The `--port` flag is the starting port number used by traffic generators, which should be non-overlapping.
For example:

```bash
./compose.sh tgcs --prefix=iperf3internet --port=21000 \
  --iperf3='internet | * | -t 60 -u -b 10M' --iperf3='internet | * | -t 60 -u -b 50M -R'

./compose.sh tgcs --prefix=iperf3vehicle --port=24000 \
  --iperf3='vcam | * | -t 60 -u -b 20M' --iperf3='vctl | * | -t 60 -u -b 1M -R'

./iperf3internet.sh
./iperf3vehicle.sh
```

### Subcommands of Generated bash Script

Normally, you can run `PREFIX.sh` script without parameter, to execute all the steps:

```bash
./tg.sh
```

The script has these steps / subcommands:

```bash
# start servers and sleep 5 seconds
./tg.sh servers

# start clients
./tg.sh clients

# wait for clients to finish
./tg.sh wait

# gather container outputs
./tg.sh collect

# delete servers and clients
./tg.sh stop

# tally overall statistics
./tg.sh stats
```
