# Open5GCore in Docker Compose

Requirements:

* Ubuntu 22.04
* Node.js 18.x
* Open5GCore proprietary repository cloned at `~/phoenix-repo` (dependency installation not needed)
* This repository cloned at `~/5gdeploy`

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

## Convert ip-map to Compose file

```bash
# convert ph_init to Compose
cd ~/5gdeploy
corepack pnpm -s start compose/main.ts --cfg ~/phoenix-repo/phoenix-src/cfg/5g --out ~/compose/phoenix

# start Docker Compose
cd ~/compose/phoenix
docker compose up -d

# interact with phoenix process in a container
# (quit with key sequence CTRL+P CTRL+Q; do not press CTRL+C)
docker attach ue1

# interact with bash prompt in a container
# (quit with CTRL+D or 'exit' command)
docker exec -it ue1 bash

# shutdown Docker Compose
cd ~/compose/phoenix
docker compose down
```
