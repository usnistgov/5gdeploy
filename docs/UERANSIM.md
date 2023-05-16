# UERANSIM in Docker Compose

See [installation](INSTALL.md) for how to install common dependencies.

Build UERANSIM Docker images:

```bash
docker build --pull -t herlesupreeth/ueransim \
  'https://github.com/herlesupreeth/docker_open5gs.git#master:ueransim'

cd ~/5gdeploy
docker build -t ueransim docker/ueransim
```

## Open5GCore + UERANSIM

See [Open5GCore](Open5GCore.md) for how to use `phoenix` Docker image.

```bash
# prepare Compose context
cd ~/5gdeploy
corepack pnpm -s phoenix-compose --cfg ~/phoenix-repo/phoenix-src/cfg/5g_nssf --out ~/compose/ueransim-phoenix --ran docker/ueransim/compose.phoenix.yml

# start Docker Compose
cd ~/compose/ueransim-phoenix
docker compose up -d

# interact with nr-cli
# (quit with CTRL+D)
docker exec -it ue ./nr-cli imsi-001011234567896

# ping test
docker exec -it ue ping -I uesimtun0 -c4 192.168.15.60

# shutdown Docker Compose
cd ~/compose/ueransim-phoenix
docker compose down
```
