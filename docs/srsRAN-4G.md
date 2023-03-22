# srsRAN 4G in Docker Compose

Requirements / assumptions:

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
docker exec -it ue ping -c4 192.168.250.1

# shutdown Docker Compose
cd ~/compose/srsran4g-lte
docker compose down
```

## 5G scenario: Open5GCore + srsENB + srsUE

Additional requirements / assumptions:

* [Open5GCore Compose file](Open5GCore.md) created in `~/compose/phoenix`
* [dasel](https://github.com/TomWright/dasel/releases) 2.x

```bash
# duplicate Compose context
mkdir -p ~/compose/srsran4g-phoenix
tar -ch -C ~/compose/phoenix . | tar -x -C ~/compose/srsran4g-phoenix

# modify Open5GCore config
cd ~/compose/srsran4g-phoenix
jq '(.Phoenix.Module[]|select(.binaryFile|endswith("amf.so")).config.trackingArea[].taiList) |= [{tac:117}]' \
  ~/compose/phoenix/cfg/amf.json >cfg/amf.json
jq '(.Phoenix.Module[]|select(.binaryFile|endswith("pfcp.so"))|.config.hacks.qfi) |= 1' \
  ~/compose/phoenix/cfg/upf1.json >cfg/upf1.json

# replace Open5GCore simulated RAN with srsRAN 4G in Compose file
cd ~/compose/srsran4g-phoenix
dasel -f ~/compose/phoenix/compose.yml -w json | jq --argjson S "$(dasel -f ~/5gdeploy/docker/srsran4g/compose.phoenix.yml -w json)" '
  .services |= with_entries(select(.key | startswith("bt") or startswith("gnb") or startswith("ue") | not)) + ($S | .services)
' >compose.yml

# start Docker Compose
cd ~/compose/srsran4g-phoenix
mkdir -p logs
docker compose up -d

# ping test
docker exec -it ue ping -c4 192.168.15.60

# shutdown Docker Compose
cd ~/compose/srsran4g-phoenix
docker compose down
```
