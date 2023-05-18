# Open5GCore in Docker Compose

See [installation](INSTALL.md) for how to install common dependencies.

Open5GCore proprietary repository should be cloned at `~/phoenix-repo`.
It is unnecessary to run `prereq.sh` or `ph_init.sh` script.

Build Open5GCore Docker image:

```bash
cd ~/phoenix-repo/phoenix-src
docker build --pull -t localhost/phoenix \
  --build-arg UBUNTU_VERSION=22.04 \
  --build-arg CACHE_PREFIX= \
  -f deploy/docker/Dockerfile .

cd ~/5gdeploy
docker build -t phoenix docker/phoenix
```

## Convert ph_init to Compose

```bash
# convert ph_init to Compose
cd ~/5gdeploy
corepack pnpm -s phoenix-compose --cfg ~/phoenix-repo/phoenix-src/cfg/5g --out ~/compose/phoenix

# start Docker Compose
cd ~/compose/phoenix
docker compose up -d

# interact with phoenix process in a container
# (quit with key sequence CTRL+P CTRL+Q; do not press CTRL+C)
docker attach ue1

# interact with bash prompt in a container
# (quit with CTRL+D or 'exit' command)
docker exec -it ue1 bash

# interact with UE via JSON-RPC
cd ~/5gdeploy
UE1MGMT=$(docker inspect -f '{{(index .NetworkSettings.Networks "br-mgmt").IPAddress}}' ue1)
corepack pnpm -s phoenix-rpc --host $UE1MGMT ue-status
corepack pnpm -s phoenix-rpc --host $UE1MGMT ue-register
corepack pnpm -s phoenix-rpc --host $UE1MGMT ue-deregister

# shutdown Docker Compose
cd ~/compose/phoenix
docker compose down
```

You can change `~/phoenix-repo/phoenix-src/cfg/5g` to another Open5GCore example scenario.
Some, but not all, examples can work in Docker Compose.

## Run Scenario over Multiple Machines

Build bridge Docker image:

```bash
cd ~/5gdeploy
docker build -t bridge docker/bridge
```

Run a subnet of network functions with bridges:

```bash
# prepare Compose file with bridge setup
cd ~/5gdeploy
corepack pnpm -s phoenix-compose --cfg ~/phoenix-repo/phoenix-src/cfg/5g_scp --out ~/compose/phoenix-scp --bridge-on conn --bridge-to 192.0.2.1,192.0.2.2

# copy ~/compose/phoenix-scp and Docker images to both machines

# start network functions on first machine
cd ~/compose/phoenix-scp
docker compose up -d bridge upf1 upf2 igw hostnat sql scp1 nrf1 amf smf gnb1 ue1 ue2

# start network functions on second machine
cd ~/compose/phoenix-scp
docker compose up -d bridge sql scp2 nrf2 udm ausf
```
