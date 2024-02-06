# 5gdeploy/phoenix-compose

Command **phoenix-compose** transforms Open5GCore ip-map config to Docker Compose.
During this transformation, it can:

* Replace Radio Access Network (RAN) with another software.
* Split the deployment to multiple host machines bridged via VXLAN or Ethernet.

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
corepack pnpm -s phoenix-rpc --host ue1 ue-status
corepack pnpm -s phoenix-rpc --host ue1 ue-register
corepack pnpm -s phoenix-rpc --host ue1 ue-deregister

# shutdown Docker Compose
cd ~/compose/phoenix
docker compose down
```

You can change `~/phoenix-repo/phoenix-src/cfg/5g` to another Open5GCore example scenario.
Some, but not all, examples can work in Docker Compose.

## Run over Multiple Machines

Run a subnet of network functions with bridges:

```bash
# prepare Compose file with bridge setup
cd ~/5gdeploy
corepack pnpm -s phoenix-compose --cfg ~/phoenix-repo/phoenix-src/cfg/5g_scp --out ~/compose/phoenix-scp \
  --bridge conn,eth,scp1=02:00:00:00:00:01,scp2=02:00:00:00:00:02

# copy ~/compose/phoenix-scp and Docker images to both machines

# start network functions on first machine
cd ~/compose/phoenix-scp
docker compose up -d bridge upf1 upf2 igw hostnat sql scp1 nrf1 amf smf gnb1 ue1 ue2

# start network functions on second machine
cd ~/compose/phoenix-scp
docker compose up -d bridge sql scp2 nrf2 udm ausf
```

See [multi-host deployment](../docs/multi-host.md) for more information on `--bridge` flag.
However, phoenix-compose does not support `--place` flag; instead, you must write container names on `docker compose up` command line.

## Open5GCore + srsENB + srsUE

```bash
# build srsRAN 4G Docker image (not built in install.sh)
cd ~/5gdeploy/docker
./build.sh srsran4g

# prepare Compose context
cd ~/5gdeploy
corepack pnpm -s phoenix-compose --cfg ~/phoenix-repo/phoenix-src/cfg/5g --out ~/compose/srsran4g-phoenix --ran docker/srsran4g/compose.phoenix.yml

# modify Open5GCore config
cd ~/compose/srsran4g-phoenix
jq '(.Phoenix.Module[]|select(.binaryFile|endswith("amf.so")).config.trackingArea[].taiList) |= [{tac:117}]' \
  ~/phoenix-repo/phoenix-src/cfg/5g/amf.json >cfg/amf.json
jq '(.Phoenix.Module[]|select(.binaryFile|endswith("pfcp.so"))|.config.hacks.qfi) |= 1' \
  ~/phoenix-repo/phoenix-src/cfg/5g/upf1.json >cfg/upf1.json

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

## Open5GCore + UERANSIM

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
