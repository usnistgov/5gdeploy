# 5gdeploy scenario

This folder contains concrete scenario scripts for [5gdeploy](https://gitlab.nist.gov/gitlab/jns23/5gdeploy).
Please report issues and request new scenarios via "6G Core Network Project" Teams "Testbed" channel.

## Installation and Usage

These installation steps are required for all scenarios:

1. Clone **5gdeploy** at `~/5gdeploy`.
2. Follow **5gdeploy** `INSTALL.md` instructions to install Node.js and Docker.
3. Clone Open5GCore proprietary repository at `~/phoenix-repo`.
4. Clone this folder at `~/5gdeploy-scenario`.
5. Run `bash ./install.sh` to install dependencies.

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
# If you ask for help, attach this log file, do not send screenshots.

# stop a scenario
cd ~/compose/20230601
docker compose down --remove-orphans
```
