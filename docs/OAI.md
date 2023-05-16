# OpenAirInterface5G in Docker Compose

See [installation](INSTALL.md) for how to install common dependencies.

Build OpenAirInterfaces Docker images:

```bash
cd ~/5gdeploy
docker build --pull -t oai-gnb \
  --build-arg BASE=oaisoftwarealliance/oai-gnb:develop \
  docker/oai
docker build --pull -t oai-nr-ue \
  --build-arg BASE=oaisoftwarealliance/oai-nr-ue:develop \
  docker/oai
```

## Open5GCore + oai-gnb + oai-nr-ue

See [Open5GCore](Open5GCore.md) for how to use `phoenix` Docker image.

```bash
# prepare Compose context
cd ~/5gdeploy
corepack pnpm -s phoenix-compose --cfg ~/phoenix-repo/phoenix-src/cfg/5g --out ~/compose/oai-phoenix --ran docker/oai/compose.phoenix.yml

# start Docker Compose
cd ~/compose/oai-phoenix
docker compose up -d

# ping test
docker exec -it ue ping -I oaitun_ue1 -c4 192.168.15.60

# shutdown Docker Compose
cd ~/compose/oai-phoenix
docker compose down
```
