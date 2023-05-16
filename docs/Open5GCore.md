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
