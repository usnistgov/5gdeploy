# UERANSIM in Docker Compose

See [installation](INSTALL.md) for how to install common dependencies.

Build UERANSIM Docker images:

```bash
http --ignore-stdin --follow GET https://github.com/herlesupreeth/docker_open5gs/raw/a621683e88ff48bd93cb91eb08f7d127d1666a83/ueransim/Dockerfile \
| sed -e '/^COPY [^-]/ d' -e '/^CMD / d' -e '/cd UERANSIM/ s|git checkout \S*|git checkout 3a96298fa284b0da261a60439b21c1adf1677aea|' \
| docker build --pull -t herlesupreeth/ueransim -

cd ~/5gdeploy
docker build -t 5gdeploy.localhost/ueransim docker/ueransim
```

## Open5GCore + UERANSIM

See [Open5GCore](Open5GCore.md) for how to use `5gdeploy.localhost/phoenix` Docker image.

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
