# 5gdeploy scenario

This folder contains concrete scenario scripts for [5gdeploy](https://gitlab.nist.gov/gitlab/jns23/5gdeploy).
Please report issues and request new scenarios via "6G Core Network Project" Teams "Testbed" channel.

Scenario list and brief description:

* [20230510](20230510): cloud and edges
* [20230817](20230510): 3-slice with unshared UPFs

## Installation and Usage

These installation steps are required for all scenarios:

1. Clone **5gdeploy** at `~/5gdeploy`.
2. Follow **5gdeploy** `INSTALL.md` instructions to install Node.js and Docker.
3. Clone Open5GCore proprietary repository at `~/phoenix-repo`.
4. Clone this folder at `~/5gdeploy-scenario`.
5. Run `bash ./install.sh` to install dependencies.

If free5GC is needed, load the gtp5g module:

```bash
bash ~/5gdeploy/free5gc-config/load-gtp5g.sh
# Repeat this step after every reboot.
```

Each scenario has a usage guide in its README.
Some common commands are:

```bash
# generate Compose file
cd ~/5gdeploy-scenario
bash generate.sh 20230601
# Command line flags are passed to netdef-compose script. Sometimes they are required.
# Compose file will be generated at ~/compose/20230601. Existing files in this folder are deleted.

# start a scenario
cd ~/compose/20230601
docker compose up -d
# You can only run one scenario at a time. Shutdown other scenarios before starting one.
# Generally a scenario takes 30~60 seconds to start and stabilize, please be patient.

# start a scenario with traffic capture
cd ~/compose/20230601
docker compose create
dumpcap -i br-cp -i br-n2 -i br-n3 -w ~/1.pcapng  # run this in another console
docker compose up -d

# list running containers
docker ps -a
# Seeing any "Exited" container indicates an error. Investigate by viewing container logs.

# view container logs
docker logs -f amf1

# save container logs
docker logs amf1 >amf1.log
# If you ask for help regarding a container, attach this log file, do not send screenshots.

# stop a scenario
cd ~/compose/20230601
docker compose down --remove-orphans
```

## Multi-Host Preparation

Some scenarios can/should be deployed over multiple hosts.
Typically, one host is designated as *primary* and all other hosts are designed as *secondary*.

The *primary* host should have:

* Docker Engine
* Node.js
* `install.sh` completion
* kernel module for free5GC, if needed
* [yq](https://github.com/mikefarah/yq): `sudo snap install yq`
* [Rclone](https://rclone.org/): `sudo apt install rclone`

The *secondary* host should have:

* Docker Engine
* kernel module for free5GC, if needed

The *primary* host should have SSH config and keys to access each *secondary* host.
The SSH user on each *secondary* host should be added to the `docker` group.
The SSH host key of each *secondary* host should be added to the `known_hosts` file on the *primary* host.
If the command below does not work, re-check these SSH requirements.

Copy Docker images to *secondary* hosts:

```bash
for H in secondary1 secondary2; do
  docker save $(docker images --format='{{.Repository}}' | grep 5gdeploy.localhost) | docker -H ssh://$H load
done
```
