# UERANSIM in Docker Compose

Requirements / assumptions:

* Ubuntu 22.04
* This repository cloned at `~/5gdeploy`

Build UERANSIM Docker images:

```bash
docker build --pull -t herlesupreeth/ueransim \
  'https://github.com/herlesupreeth/docker_open5gs.git#master:ueransim'

cd ~/5gdeploy
docker build -t ueransim docker/ueransim
```

## Open5GCore + UERANSIM

Additional requirements / assumptions:

* [Open5GCore Compose file](Open5GCore.md) created in `~/compose/phoenix`
* [dasel](https://github.com/TomWright/dasel/releases) 2.x

```bash
# duplicate Compose context
mkdir -p ~/compose/ueransim-phoenix
tar -ch -C ~/compose/phoenix . | tar -x -C ~/compose/ueransim-phoenix

# replace Open5GCore simulated RAN with UERANSIM in Compose file
cd ~/compose/ueransim-phoenix
dasel -f ~/compose/phoenix/compose.yml -w json | jq --argjson S "$(dasel -f ~/5gdeploy/docker/ueransim/compose.phoenix.yml -w json)" '
  .services |= with_entries(select(.key | startswith("bt") or startswith("gnb") or startswith("ue") | not)) + ($S | .services)
' >compose.yml

# start Docker Compose
cd ~/compose/ueransim-phoenix
docker compose up -d

# ping test
docker exec -it ue ping -I uesimtun0 -c4 192.168.15.60

# shutdown Docker Compose
cd ~/compose/ueransim-phoenix
docker compose down
```
