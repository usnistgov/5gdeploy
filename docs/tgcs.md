# Client-Server Traffic Generators

Many traffic generators have a client-server architecture, including:

* iperf2
* iperf3
* OWAMP and TWAMP
* netperf
* sockperf

These traffic generators are supported through `./compose.sh tgcs` subcommand.
See [traffic generators](trafficgen.md) for other traffic generators.

## Basic Usage

`./compose.sh tgcs` defines a measurement set that runs one or more client-server traffic generators.

```bash
./compose.sh tgcs --prefix=PREFIX --port=PORT --startup-delay=DELAY \
  --TGID='DN-PATTERN | UE-PATTERN | CLIENT-FLAGS | SERVER-FLAGS'
```

There's a traffic flow flag for each traffic generator type, such as `--iperf3` or `--owamp`.
The traffic flow flags are repeatable.
Each flag value consists of four parts, separated by `|` character:

1. a [minimatch](https://www.npmjs.com/package/minimatch) pattern that matches a Data Network Name (DNN)
2. a minimatch pattern that matches a UE SUPI
3. a sequence of client flags
4. a sequence of server flags

The command gathers information about currently connected PDU sessions (same as `list-pdu` subcommand), matches the DNN and SUPI against the patterns in traffic flow flags, and defines a pair of client and server for each matched PDU sessions.
Normally, the client shares a netns with the UE container, and the server shares a netns with the DN container; it's possible to reverse the direction as described in [advanced usage](tgcs-advanced.md).
Each traffic flow flag is processed separately, so that the same PDU session may match multiple flags and create multiple pairs of clients and servers.

Several traffic generators can recognize special client/server flags that start with `#` symbol.
These are translated by tgcs script and not passed to the traffic generator program.
They must be specified before other flags that do not start with `#` symbol.

![topology diagram with client-server traffic generators](tgcs-topo.svg)

Optional flags:

* `--prefix` flag specifies container name prefix and stats directory name.
  Default is "tg".
* `--port` flag specifies the port number used by the first traffic generator.
  Default is 20000.
* `--startup-delay` flag specifies wait duration between starting server containers and starting client containers.
  Default is 5 seconds.
* `--t0-delay` flag sets `$TGCS_T0` timestamp variable, described in [advanced usage](tgcs-advanced.md).
  Default is 30 seconds since starting client containers.
* `--wait-timeout` flag sets a timeout while waiting for clients to finish.
  Default is 3600 seconds since client containers have started.

The command prints a brief report on the matched PDU sessions and traffic flows.
If there are fewer than expected traffic flows, please check that UEs are registered and PDU sessions have been established.

The outputs are:

* Compose file `compose.PREFIX.yml`, which defines necessary traffic generator containers.
* bash script `PREFIX.sh`, which runs traffic generator containers and saves statistics in `~/compose/20230601/PREFIX` stats directory.
* TSV file `PREFIX.tsv`, which has the same information as the brief report.
  This is automatically copied into the stats directory as `setup.tsv`.

## iperf2

`--iperf2` traffic flow flag prepares throughput measurement using [iperf2](https://iperf2.sourceforge.io/).

This requires uses a custom Docker image built on the primary host.
To transfer the image to secondary hosts, run `./PREFIX.sh upload` before the first run.

```bash
# prepare benchmark script
./compose.sh tgcs --iperf2='internet | * | -t 60 -i 1 -u -l 1200 -b 10M | -i 1 -u -l 1200'

# add '#text' client flag for text output
./compose.sh tgcs --iperf2='internet | * | #text -t 60 -i 1 -u -l 1200 -b 10M | -i 1 -u -l 1200'

# measure one-way latency with --trip-times
./compose.sh tgcs --iperf2='internet | * | -t 60 -i 1 -u -l 1200 -b 10M --trip-times | -i 1 -u -l 1200'

# upload custom Docker image before the first run, see notes above
./tg.sh upload

# run benchmark
./tg.sh
```

Client flags are passed to [iperf2 client](https://iperf2.sourceforge.io/iperf-manpage.html#lbAG).
Server flags are passed to [iperf2 server](https://iperf2.sourceforge.io/iperf-manpage.html#lbAF).
The `-e` flag for "enhanced output" is always included and need not be specified.

To use UDP traffic, pass `-u` in both client flags and server flags; otherwise, it is TCP traffic.
It is an error to set UDP traffic on one side and TCP traffic on the other side.

The `-yC` flag for CSV output is included by default.
To obtain text output instead, add `#text` in client flags.
In either case, you should specify `-i` flag to enable interval reports.

The outputs of each iperf2 container are saved in the stats directory.
The script shows a brief summary of iperf2 flows that have text output.

### Delayed TX Start

The `--txdelay-time` client flag delays TX by several seconds.
The `--txstart-time` client flag delays TX start until an absolute timestamp.
These flags reduces the probability of control connection failure due to network congestion.

To use the `--txstart-time` client flag, you can set its value to a variable that is interpolated by Docker Compose at runtime.

```bash
# prepare the measurement, notice the single quotes so that bash does not expand the variable
./compose.sh tgcs --iperf2='internet | *
  | -t 60 -i 1 -u -l 1200 -b 10M --txstart-time $IPERF2_TXSTART
  | -i 1 -u -l 1200
'

# run the traffic generators, pass the environment variable
IPERF2_TXSTART="$(expr $(date -u +%s) + 30)" ./tg.sh
```

## iperf3

`--iperf3` traffic flow flag prepares throughput measurement using [iperf3](https://software.es.net/iperf/).

```bash
# prepare benchmark script
./compose.sh tgcs --iperf3='internet | * | -t 60 -u -l 1200 -b 10M'
./compose.sh tgcs --iperf3='internet | * | -t 60 -u -l 1200 -b 10M -R'

# add '#text' client flag for text output
./compose.sh tgcs --iperf3='internet | * | #text -t 60 -u -l 1200 -b 10M --bidir'

# run benchmark
./tg.sh
```

Client flags are passed to iperf3 client.
Use `#start` client flag for delayed client start, described in [advanced usage](tgcs-advanced.md).
Server flags are not accepted.

The `--json` flag for JSON output is included by default.
To obtain text output instead, add `#text` in client flags.

The outputs of each iperf3 container are saved in the stats directory.
The script shows a brief summary of iperf3 flows that have JSON output.

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
Use `#start` client flag for delayed client start, described in [advanced usage](tgcs-advanced.md).
Server flags are not accepted.

### Session File

You can pass flags to owping/twping within the third part of traffic flow flags.
`-F` and `-T` flags are handled specially: the filename that follows either flag is ignored.
Instead, it is set to a file in the stats directory.

OWAMP session files can be further analyzed with `owstats` command.

```bash
./compose.sh tgcs --port=21000 --owamp='internet | *1000 | -F x -T x'
./tg.sh

alias owstats='docker run --rm --mount type=bind,source=$(pwd),target=/data,readonly=true -w /data perfsonar/tools owstats'
owstats -R ./tg/owamp_0-21000-F.owp
owstats -R ./tg/owamp_0-21000-T.owp
```

There isn't a tool to analyze TWAMP session files.
To see the raw output, it's advised to pass either `-R` or `-v` flag to twping.

In a multi-host deployment, the session file is stored on the host where the container generating the file is placed, which might be a secondary host.
The stats directories are at the same path on every host.

## Netperf

`--netperf` traffic flow flag prepares a [netperf](https://hewlettpackard.github.io/netperf/doc/netperf.html) benchmark.

```bash
./compose.sh tgcs --netperf='internet | * | -t OMNI -j -- -T UDP -d send -o all'
./tg.sh
```

Client flags are passed to `netperf`.
Use `#start` client flag for delayed client start, described in [advanced usage](tgcs-advanced.md).
Server flags are passed to `netserver`.

The script cannot identify the traffic direction of each flow in the brief report.
The script cannot gather summary information from the output.

## Sockperf

`--sockperf` traffic flow flag prepares a [sockperf](https://manpages.ubuntu.com/manpages/jammy/man1/sockperf.1.html) benchmark.

This requires uses a custom Docker image built on the primary host.
To transfer the image to secondary hosts, run `./PREFIX.sh upload` before the first run.

```bash
# prepare benchmark script for uplink traffic
./compose.sh tgcs --sockperf='internet | * | under-load --full-log x --full-rtt -t 30 -m 800 -b 1 --mps 1000 | -g'
./compose.sh tgcs --sockperf='internet | * | ping-pong  --full-log x --full-rtt -t 30 -m 800 -b 1            | -g'
./compose.sh tgcs --sockperf='internet | * | throughput --full-log x --full-rtt -t 30 -m 800 -b 1            | -g'

# prepare benchmark script for downlink traffic
./compose.sh tgcs --sockperf='internet | * | #R under-load --full-log x --full-rtt -t 30 -m 800 -b 1 --mps 1000 | -g'

# upload custom Docker image before the first run, see notes above
./tg.sh upload

# run benchmark
./tg.sh
```

Client flags, starting with a subcommand such as `under-load` or `throughput`, are passed to `sockperf`.
Use `#start` client flag for delayed client start, described in [advanced usage](tgcs-advanced.md).
Server flags are passed to `sockperf server`.

Sockperf only supports unidirectional traffic from client to server.
To achieve downlink traffic, use `#R` client flag for reverse the direction, described in [advanced usage](tgcs-advanced.md).

Similar to OWAMP, the filename that follows `--full-log` is set to a file in the stats directory, which can be analyzed later.

### Playback Mode

```bash
# generate playback file with gen2.awk
docker run -i --rm 5gdeploy.localhost/sockperf gen2.awk >gen2.csv <<EOT
  00.01 29.99 1000 4000 1250
  30.01 29.99 4000 9000 1250
  60.01 29.99 9000 9000 1250
  90.01 29.99 9000 4000 1250
EOT

# transfer playback file to secondary host, if necessary
scp gen2.csv SECONDARY:$PWD/gen2.csv

# prepare for uplink traffic; add '#R' client flag for downlink traffic
./compose.sh tgcs --sockperf='internet | * | playback --data-file '$PWD/gen2.csv' --full-log x --full-rtt | -g'
```

Sockperf playback mode requires a playback file as input.
It is a CSV file where each record describes a packet to be transmitted.
First column is a timestamp (monotonically increasing); second column is UDP payload length (between 14 and 65000).
The sample command uses [gen2.awk](https://github.com/Mellanox/sockperf/blob/91b10ca095ea2efe6aaab830e34c2afe2c3e4cbf/tools/gen2.awk) to generate a playback file.

The `--data-file` flag should be set to the absolute path of the playback file.
In a multi-host deployment, this file must be present on the host that runs the sockperf playback, which may or may not be the primary host.
The playback file would be bind-mounted into the container at the same path so that it is readable by sockperf.

This mode would not work in a multi-UE container (e.g. UERANSIM) due to implementation limitation (lack of `--client_ip` flag).

### Troubleshooting

During startup, `bind source path does not exist` for the playback file:

* Did you upload the playback file to the secondary host where the sender would be running?

During startup, `Error Get "http://5gdeploy.localhost/v2/"`:

* Did you transfer the sockperf Docker image to secondary hosts?
* `./tg.sh upload`

After finishing, log contains `ERROR: _seqN > m_maxSequenceNo`:

* Sockperf measures time with RDTSC intrinsic.
* RDTSC may be unreliable on multi-socket systems and virtual machines, see [Pitfalls of TSC usage](https://oliveryang.net/2015/09/pitfalls-of-TSC-usage/).
* To avoid this error, add `--no-rdtsc` to both server flags and client flags.
* However, not using RDTSC would reduce performance.

## D-ITG

`--itg` traffic flow flag prepares a [D-ITG](https://traffic.comics.unina.it/software/ITG/manual/) benchmark.

```bash
# single-flow mode
./compose.sh tgcs --itg='internet | * | -t 30000 -C 3000 -c 1200'

# multi-flow mode
./compose.sh tgcs --itg='internet | * | #f=5 -t 30000 -O 3000 -u 800 1200'
```

Client flags are passed to [`ITGSend`](https://traffic.comics.unina.it/software/ITG/manual/index.html#SECTION00042000000000000000) command.
Use `#start` client flag for delayed client start, described in [advanced usage](tgcs-advanced.md).
Use `#R` client flag for reverse direction, described in [advanced usage](tgcs-advanced.md).
Use `#f` client flag to send multiple flows from the each client, up to 39 flows.
Server flags are not accepted.

Packet-level logs on both client and server are always saved in the stats directory.
They can be further analyzed with [`ITGDec`](https://traffic.comics.unina.it/software/ITG/manual/index.html#SECTION00045000000000000000) command.

```bash
alias ITGDec='docker run --rm --mount type=bind,source=$(pwd),target=/data -w /data jjq52021/ditg ITGDec'

ITGDec tg/itg_0-20000-s.itg -v -c 1000 tg/itg_0-20000-s.c.tsv
```
