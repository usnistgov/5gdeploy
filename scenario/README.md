# 5gdeploy/scenario

Package **scenario** contains a collection of concrete scenarios.
Each scenario has a `scenario.ts` script that prints a [NetDef](../netdef) object, which can be passed to [netdef-compose](../netdef-compose) command to generate a Compose context.

Scenario list and brief description:

* [20230510](20230510): cloud and edges
* [20230817](20230817): phones and vehicles, 3-slice with 3 UPFs
* [20231017](20231017): phones and vehicles, 2-slice with 2 UPFs
* [20231214](20231214): phones and vehicles, 2-slice with 1 UPF
* [20240129](20240129): many slices

## Basic Usage

Each scenario has a usage guide in its README.
Some common commands are:

```bash
# generate Compose file
cd ~/5gdeploy/scenario
./generate.sh 20230601
# Command line flags starting with + are passed to the scenario generator script.
# Command line flags starting with -- are passed to netdef-compose script.
# Some flags may be required due to limitations of 5G implementations.
# Compose file will be generated at ~/compose/20230601. Existing files in this folder are deleted.

# start a scenario
cd ~/compose/20230601
./compose.sh up
# You may only run one scenario at a time. Shutdown other scenarios before starting one.
# Generally a scenario takes 30~60 seconds to start and stabilize, please be patient.

# start a scenario with traffic capture
cd ~/compose/20230601
./compose.sh create
dumpcap -i br-cp -i br-n2 -i br-n3 -w ~/1.pcapng  # run this in another console
./compose.sh up # or 'docker compose up -d' in single-host deployment

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

## Multi-Host Preparation

Some scenarios can/should be deployed over multiple hosts.
Typically, one host is designated as *primary* and all other hosts are designed as *secondary*.

The *primary* host should have:

* Docker Engine
* Node.js
* `install.sh` completion
* kernel module for free5GC, if needed

The *secondary* host should have:

* Docker Engine
* kernel module for free5GC, if needed

The *primary* host should have SSH config and `id_ed25519` key to access each *secondary* host.
The SSH user on each *secondary* host should be added to the `docker` group.
The SSH host key of each *secondary* host should be added to the `known_hosts` file on the *primary* host.
If the command below does not work, re-check these SSH requirements.

Copy Docker images to *secondary* hosts:

```bash
cd ~/5gdeploy/scenario
./upload.sh docker 192.168.60.2 192.168.60.3
# change these IP addresses to the hosts in your setup
```
