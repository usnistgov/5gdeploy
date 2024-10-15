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
This requires a synchronized clock between client and server.
It is safe to use when UE and DN containers are placed on the same host.

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

## iperf3

`--iperf3` traffic flow flag prepares throughput measurement using [iperf3](https://software.es.net/iperf/).

```bash
./compose.sh tgcs --iperf3='* | * | -t 60 -u -b 10M' --iperf3='* | * | -t 60 -u -b 10M -R'
./tg.sh
```

Client flags are passed to iperf3 client.
`#start` may be passed as the first client flag for delayed client start, described in "advanced usage" section.
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
`#start` may be passed as the first client flag for delayed client start, described in "advanced usage" section.
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
`#start` may be passed as the first client flag for delayed client start, described in "advanced usage" section.
Server flags are passed to `netserver`.

The script cannot identify the traffic direction of each flow in the brief report.
The script cannot gather summary information from the output.

## Sockperf

`--sockperf` traffic flow flag prepares a [sockperf](https://manpages.ubuntu.com/manpages/jammy/man1/sockperf.1.html) benchmark.

Sockperf relies on a custom Docker image that is built on the primary host during installation.
To transfer the image to secondary machines, run `./compose.sh upload compose.PREFIX.yml` before running `PREFIX.sh`.

### Uplink Traffic

```bash
./compose.sh tgcs --sockperf='internet | * | under-load --full-log x --full-rtt -t 30 -m 800 -b 1 --reply-every 100 --mps 1000 | server -g'
./tg.sh
```

Both client and server flags are passed to `sockperf`.
Client flags should start with a subcommand such as `under-load` or `throughput`.
Server flags should either be omitted or start with the `server` subcommand.
`#start` may be passed as the first client flag for delayed client start, described in "advanced usage" section.

Similar to OWAMP, the filename that follows `--full-log` is set to a file in the stats directory, which can be analyzed later.

### Downlink Traffic

```bash
./compose.sh tgcs --sockperf='internet | *
  | #start=$SOCKPERF_S_START server -g
  | #start=$SOCKPERF_C_START under-load --full-log x --full-rtt -t 30 -m 800 -b 1 --reply-every 100 --mps 1000
'
SOCKPERF_S_START="$(expr $(date -u +%s) + 25)" SOCKPERF_C_START="$(expr $(date -u +%s) + 30)" ./tg.sh
```

Sockperf only supports unidirectional traffic from client to server.
To achieve downlink traffic, it's necessary to run sockperf server in the UE netns and run sockperf client in the DN netns.
In this case, "client" (UE netns) flags should start with the `server` subcommand, and "server" (DN netns) flags should start with a client subcommand such as `under-load` or `throughput`.
You must use `#start` flag to start sockperf servers before sockperf clients.

### Playback Mode

```bash
./compose.sh tgcs --sockperf='internet | * | playback --data-file '$HOME/gen1.csv' | server -g'

./compose.sh tgcs --sockperf='internet | *
  | #start=$SOCKPERF_S_START server -g
  | #start=$SOCKPERF_C_START playback --data-file '$HOME/gen1.csv'
'
```

Sockperf playback mode requires a `--data-file` input.
This should be set to the absolute path of a file that exists on the host where the sockperf container would run.
It would be bind-mounted into the container at the same path.

## Advanced Usage

### CPU Allocation

By default, traffic generator client and server containers inherit the cpuset assigned to the respective UE and DN containers.
This may cause CPU contention between traffic generator client and the UE process, as well as among traffic generator servers attached to the same DN.
It's possible to override CPU allocation with `--place=PATTERN@HOST(CPUSET)` flags, which cause containers on *HOST* whose names match *PATTERN* to be assigned with CPU cores within *CPUSET*.
For example:

```bash
./compose.sh tgcs --iperf3='internet | * | -t 60 -u -b 10M' \
  --place='*_c@(12-15)' --place='*_s@192.168.60.3(16-19)'
```

In the example, the first `--place` flag assigns cores in cpuset 12-15 to clients on the primary host, the second `--place` flag assigns cores in cpuset 16-19 to servers on the specified secondary host.
Note that the semantics of *HOST* differs from the `--place` flag in [multi-host](multi-host.md): it is a match condition here, rather than a placement instruction.

Normally, [netdef-compose](../netdef-compose/README.md) assigns a dedicated CPU core to each DN or UE container.
When you are assigning explicit cpuset to traffic generators, dedicated CPU cores become unnecessary for DN containers and for UE containers where the UE process does not participate in user plane traffic.
You can turn off these assignments with `--dn-workers=0 --phoenix-ue-isolated=NONE`.

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

### Delayed Client Start

The `#start` client flag delays client start until an absolute timestamp.
This flag is translated by tgcs script and not passed to the client program.
It must be specified as the first client flag.
Its value must reference an environment variable that is resolved during `PREFIX.sh` invocation.

Usage example:

```bash
# prepare the measurement, notice the single quotes so that bash does not expand the variable
./compose.sh tgcs \
  --iperf3='* | * | #start=$IPERF3_0_START -t 60 -u -b 10M' \
  --iperf3='* | * | #start=$IPERF3_1_START -t 60 -u -b 10M -R'

# run the traffic generators, pass the environment variable
IPERF3_0_START="$(expr $(date -u +%s) + 30)" IPERF3_1_START="$(expr $(date -u +%s) + 45)" ./tg.sh
```

Comparison with similar features:

* `--startup-delay` flag:
  * It is a top-level flag passed to tgcs.ts script.
  * It is realized as a `sleep` command in the `PREFIX.sh` bash script.
  * It allows time for the servers to become ready, but does not ensure clients start at the same time.
* `#start` flag:
  * It is passed as the first client flag in a traffic flow flag, in supported traffic generator types only.
  * It only affects traffic generator clients created by this traffic flow flag.
  * It is realized as a `sleep` command within the client container.
  * It helps ensure client programs start at the same time.
    Once they start, they will establish control connections and, generally, immediately start transmission.
* `--txstart-time` flag:
  * It is only supported in iperf2 as a client flag, which is passed to the iperf2 client program.
  * iperf2 clients will establish control connection immediately but delay transmission until the specified time.

### Subcommands of Generated bash Script

Normally, you can run `PREFIX.sh` script without parameter, to execute all the steps:

```bash
./tg.sh
# this would also clear the result directory
```

The script has these steps / subcommands:

```bash
# start servers and sleep for startup-delay
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
