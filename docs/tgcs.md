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
The client shares a netns with the UE container; the server shares a netns with the DN container.
Each traffic flow flag is processed separately, so that the same PDU session may match multiple flags and create multiple pairs of clients and servers.

![client-server traffic generators](tgcs.svg)

Optional flags:

* `--prefix` flag specifies container name prefix and stats directory name.
  Default is "tg".
* `--port` flag specifies the port number used by the first traffic generator.
  Default is 20000.
* `--startup-delay` flag specifies wait duration between starting server containers and starting client containers.
  Default is 5000 i.e. 5 seconds.

The command prints a brief report on the matched PDU sessions and traffic flows.
If there are fewer than expected traffic flows, please check that UEs are registered and PDU sessions have been established.

The outputs are:

* Compose file `compose.PREFIX.yml`, which defines necessary traffic generator containers.
* bash script `PREFIX.sh`, which runs traffic generator containers and saves statistics in `~/compose/20230601/PREFIX` stats directory.
* TSV file `PREFIX.tsv`, which has the same information as the brief report.
  This is automatically copied into the stats directory as `setup.tsv`.

## iperf2

`--iperf2` traffic flow flag prepares throughput measurement using [iperf2](https://iperf2.sourceforge.io/).

```bash
./compose.sh tgcs --iperf2='* | * | -e -i 1 -t 10 -u -l 1200 -b 10M | -e -i 1 -u -l 1200'
./tg.sh
```

Client flags are passed to [iperf2 client](https://iperf2.sourceforge.io/iperf-manpage.html#lbAG).
Server flags are passed to [iperf2 server](https://iperf2.sourceforge.io/iperf-manpage.html#lbAF).

To use UDP mode, pass `-u` in both client flags and server flags; otherwise, it is TCP mode.
It is an error to have UDP mode on one side and TCP mode on the other side.

The text outputs of each iperf2 container are saved in the stats directory.
You should not use the `--output` flag.
The script shows a brief summary of iperf2 results, but it requires interval reports to be enabled (`-i` flag) and cannot handle bidirectional traffic.

### One-way Latency (trip-times)

The `--trip-times` client flag enables measurement of one-way latency.
This requires synchronized clock between client and server.

### Delayed TX Start

The `--txdelay-time` client flag delays TX by several seconds.
The `--txstart-time` client flag delays TX start until an absolute timestamp.
These flags reduces the probability of control connection failure due to network congestion.

To use the `--txstart-time` client flag, you can set its value to a variable that is interpolated by Docker Compose at runtime.

```bash
# prepare the measurement, notice the single quotes so that bash does not expand the variable
./compose.sh tgcs \
  --iperf2='* | * | -e -i 1 -t 60 -u -l 1200 -b 10M --txstart-time $IPERF2_TXSTART | -e -i 1 -u -l 1200'

# run the traffic generators, pass the environment variable
IPERF2_TXSTART="$(expr $(date -u +%s) + 30)" ./tg.sh
```

Caution: iperf2 seems to emit erroneous results when `--txstart-time` and `-R` are used together.

### iperf2 CSV Output

If you want CSV output instead of text output, use `--iperf2csv` traffic flow flag in place of `--iperf2`.
This requires a custom Docker image built from the unreleased iperf 2.2.1 branch.
Run `./docker/build.sh iperf2` to build the image and run `./PREFIX.sh upload` to transfer the image to secondary hosts.

```bash
./compose.sh tgcs --iperf2csv='* | * | -e --trip-times -i 1 -t 10 -u -l 1200 -b 10M | -e -i 1 -u -l 1200'
# upload custom Docker image before the first run, see notes above
./tg.sh
```

The CSV outputs of each iperf2 container are saved in the stats directory, but the script cannot gather overall statistics.
If you use bidirectional traffic, the CSV file may appear interleaved; it's advised to use unidirectional traffic only.

## iperf3

`--iperf3` traffic flow flag prepares throughput measurement using [iperf3](https://software.es.net/iperf/).

```bash
./compose.sh tgcs --iperf3='* | * | -t 60 -u -b 10M' --iperf3='* | * | -t 60 -u -b 10M -R'
./tg.sh
```

Client flags are passed to iperf3 client.
Use `#start` client flag for delayed client start, described in [advanced usage](tgcs-advanced.md).
Server flags are not accepted.

The JSON outputs of each iperf3 container are saved in the stats directory.
The script shows a brief summary of iperf3 flows.

### iperf3 Text Output

If you want iperf3 text output instead of JSON output, use `--iperf3t` traffic flow flag in place of `--iperf3`.

```bash
./compose.sh tgcs --iperf3t='* | * | -t 60 -u -b 10M' --iperf3t='* | * | -t 60 -u -b 10M -R'
./tg.sh
```

The text outputs of each iperf3 container are saved in the stats directory, but the script cannot gather overall statistics.

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

Sockperf trafficgen uses a custom Docker image built on the primary host.
To transfer the image to secondary hosts, run `./PREFIX.sh upload` before the first run.

```bash
# uplink
./compose.sh tgcs --sockperf='internet | * | under-load --full-log x --full-rtt -t 30 -m 800 -b 1 --mps 1000 | -g'
./compose.sh tgcs --sockperf='internet | * | ping-pong  --full-log x --full-rtt -t 30 -m 800 -b 1            | -g'
./compose.sh tgcs --sockperf='internet | * | throughput --full-log x --full-rtt -t 30 -m 800 -b 1            | -g'

# downlink
./compose.sh tgcs --sockperf='internet | * | #R under-load --full-log x --full-rtt -t 30 -m 800 -b 1 --mps 1000 | -g'

# transfer Docker image
./tg.sh upload

# run benchmark
./tg.sh
```

Client flags, starting with a subcommand such as `under-load` or `throughput`, are passed to `sockperf`.
Use `#start` client flag for delayed client start, described in [advanced usage](tgcs-advanced.md).
Server flags are passed to `sockperf server`.

Sockperf only supports unidirectional traffic from client to server.
To achieve downlink traffic, use `#R` client flag for reverse direction, described in [advanced usage](tgcs-advanced.md).

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

During startup, `variable is not set. Defaulting to a blank string.`:

* Did you specify the environment variables referenced in `#start` flags?

After finishing, log contains `ERROR: _seqN > m_maxSequenceNo`:

* Sockperf measures time with RDTSC intrinsic.
* RDTSC may be unreliable on multi-socket systems and virtual machines, see [Pitfalls of TSC usage](https://oliveryang.net/2015/09/pitfalls-of-TSC-usage/).
* To avoid this error, add `--no-rdtsc` to both server flags and client flags.
* However, not using RDTSC would reduce performance.
