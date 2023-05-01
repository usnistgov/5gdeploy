# OpenAirInterface5G in Docker Compose

Requirements / assumptions:

* Ubuntu 22.04
* This repository cloned at `~/5gdeploy`

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

Additional requirements / assumptions:

* [Open5GCore Compose file](Open5GCore.md) created in `~/compose/phoenix`
* [dasel](https://github.com/TomWright/dasel/releases) 2.x

```bash
# duplicate Compose context
mkdir -p ~/compose/oai-phoenix
tar -ch -C ~/compose/phoenix . | tar -x -C ~/compose/oai-phoenix

# replace Open5GCore simulated RAN with srsRAN 4G in Compose file
cd ~/compose/oai-phoenix
dasel -f ~/compose/phoenix/compose.yml -w json | jq --argjson S "$(dasel -f ~/5gdeploy/docker/oai/compose.phoenix.yml -w json)" '
  .services |= with_entries(select(.key | startswith("bt") or startswith("gnb") or startswith("ue") | not)) + ($S | .services)
' >compose.yml

# start Docker Compose
cd ~/compose/oai-phoenix
docker compose up -d

# ping test
docker exec -it ue ping -I oaitun_ue1 -c4 192.168.15.60

# shutdown Docker Compose
cd ~/compose/oai-phoenix
docker compose down
```
