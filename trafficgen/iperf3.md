# 5gdeploy/trafficgen

Package **trafficgen** contains scripts that help preparing traffic generation and analyzing traffic statistics.
These scripts are integrated into [netdef-compose](../netdef-compose/README.md) command.

### iperf3

After UEs have started and PDU sessions have been established, prepare iperf3 flows:

```bash
cd ~/compose/20230601
./compose.sh iperf3 --flow='* | * | -t 60 -u -b 10M' --flow='* | * | -t 60 -u -b 10M -R'
```

This script gathers information about currently connected PDU sessions and prepares an iperf3 flow for each PDU session between UE and Data Network.
The most important command line flag is `--flow` (repeatable).
Each `--flow` value consists of:

1. a [minimatch](https://www.npmjs.com/package/minimatch) pattern that matches a Data Network Name (DNN)
2. the `|` separator
3. a minimatch pattern that matches a UE SUPI
4. the `|` separator
5. a sequence of iperf3 flags

Each PDU session whose DNN and SUPI match the patterns would have an iperf3 flow with the specified flags.
Each `--flow` flag is processed separately, so that the same PDU session may match multiple flags and generate multiple iperf3 flows.

The command prints a brief report on the matched PDU sessions and iperf3 flows.
If there are fewer than expected iperf3 flows, please check that UEs are registered and PDU sessions have been established.

The output of this script includes:

* Compose file at `~/compose/20240129/compose.iperf3.yml`, which defines necessary iperf3 containers
* bash script at `~/compose/20240129/iperf3.sh`, which runs iperf3 containers and gathers statistics in JSON format

After generation, you can run the iperf3 flows and analyze its results as follows:

```bash
cd ~/compose/20230601
./iperf3.sh
```

This command runs the pipeline and prints statistics at last.
These statistics are also saved in `iperf3.tsv`.
