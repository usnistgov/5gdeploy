# Open5GCore Deployment Helper

## Basic Instructions

```bash
# build phoenix Docker image
cd ~/phoenix-repo/phoenix-src
docker build --pull -t localhost/phoenix \
  --build-arg UBUNTU_VERSION=22.04 \
  --build-arg CACHE_PREFIX= \
  -f deploy/docker/Dockerfile .
cd /opt/phoenix-deploy
docker build -t phoenix docker/phoenix

# convert ph_init to Docker Compose
cd /opt/phoenix-deploy
corepack pnpm -s start compose/main.ts --cfg /opt/phoenix/cfg/5g --out /opt/phoenix-compose

# start Docker Compose
cd /opt/phoenix-compose
docker compose up -d

# interact with phoenix process in a container
# (quit with key sequence CTRL+P CTRL+Q; do not press CTRL+C)
docker attach ue1

# interact with bash prompt in a container
# (quit with CTRL+D or 'exit' command)
docker exec -it ue1 bash

# shutdown Docker Compose
cd /opt/phoenix-compose
docker compose down
```
