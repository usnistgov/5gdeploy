# srsRAN 4G in Docker Compose

Requirements:

* Ubuntu 22.04
* Installed packages: `httpie jq python3-minimal`
* This repository cloned at `~/5gdeploy`

Build srsRAN 4G Docker image:

```bash
cd ~/5gdeploy
docker build --pull -t srsran4g docker/srsran4g
```

## LTE scenario: srsEPC + srsENB + srsUE

```bash
# copy Compose file
mkdir -p ~/compose/srsran4g-lte && cd ~/compose/srsran4g-lte
cp ~/5gdeploy/docker/srsran4g/compose.lte.yml compose.yml

# start Docker Compose
cd ~/compose/srsran4g-lte
mkdir -p logs
docker compose up -d

# ping test
docker exec -it ue ping 192.168.250.1

# shutdown Docker Compose
cd ~/compose/phoenix
docker compose down
```
