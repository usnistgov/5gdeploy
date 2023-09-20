# Cloud and Edges

## Description

There is one *cloud* host and two *edge* hosts.
The *cloud* host runs the CP and the *cloud* data network.
Each *edge* host runs a gNB and an *edge* data network.

There are two UEs on each *edge* host.
They can access both the *cloud* data network and the local *edge* data network.
They cannot access other *edge* data networks.

```text
|------|      |------|      |-------|
|  CP  |------| UPF0 |------| cloud |
|---+--|      |----+-|      |-------|
    |              |
    \+-----+----\  +---|
     |     |    |  |   |
|----+-|   |  |-+--+-| |    |-------|
| gnb1 |---+--| UPF1 |-+----| edge1 |
|------|   |  |------| |    |-------|
           |           |
     /-----+----\  /---/
     |          |  |
|----+-|      |-+--+-|      |-------|
| gnb2 |------| UPF2 |------| edge2 |
|------|      |------|      |-------|
```

## Preparation

You need three hosts: *cloud* (primary), *edge1*, *edge2*.
See the multi-host preparation steps in [top-level README](../README.md).
All commands shall be invoked on the *cloud* host.

Define variables for SSH hostnames or IPs:

```bash
CTRL_EDGE1=edge1
CTRL_EDGE2=edge2
```

Define variables for experiment network IPs:

```bash
EXP_CLOUD=192.168.60.10
EXP_EDGE1=192.168.60.11
EXP_EDGE2=192.168.60.12
```

## Start and Stop Scenario

Generate Compose file and copy to *edge* hosts:

```bash
cd ~/5gdeploy-scenario
bash generate.sh 20230510 --ran=ueransim --bridge-on=n2,n4,n9 --bridge-to=${EXP_CLOUD},${EXP_EDGE1},${EXP_EDGE2}

eval `ssh-agent -s` && ssh-add
for H in ${CTRL_EDGE1} ${CTRL_EDGE2}; do
  rclone sync ~/compose/20230510 :sftp:compose/20230510 --sftp-host=$H
done
eval `ssh-agent -k`
```

Start the scenario:

```bash
cd ~/compose/20230510
docker compose up -d bridge upf0 dn_cloud $(yq '.services | keys | filter(test("^(dn|upf|gnb|ue)[_0-9]") | not) | .[]' compose.yml)
docker -H ssh://${CTRL_EDGE1} compose up -d bridge dn_edge1 upf1 gnb1 ue1001
docker -H ssh://${CTRL_EDGE2} compose up -d bridge dn_edge2 upf2 gnb2 ue2001
```

Stop the scenario:

```bash
cd ~/compose/20230510
docker compose down
docker -H ssh://${CTRL_EDGE1} compose down
docker -H ssh://${CTRL_EDGE2} compose down
```

## Traffic Generation

Show IP addresses of each data network:

```bash
docker exec dn_cloud ip addr show n6
docker -H ssh://${CTRL_EDGE1} exec dn_edge1 ip addr show n6
docker -H ssh://${CTRL_EDGE2} exec dn_edge2 ip addr show n6
```

Show PDU sessions and IP addresses of each UE:

```bash
docker -H ssh://${CTRL_EDGE1} exec ue1001 ./nr-cli imsi-001017005551001 -e ps-list
docker -H ssh://${CTRL_EDGE1} exec ue1001 ./nr-cli imsi-001017005551002 -e ps-list
docker -H ssh://${CTRL_EDGE2} exec ue2001 ./nr-cli imsi-001017005552001 -e ps-list
docker -H ssh://${CTRL_EDGE2} exec ue2001 ./nr-cli imsi-001017005552002 -e ps-list
```

To send packets between a UE and a data network, you should:

1. Start a container that joins the network namespace of the DN container.
2. Run server application that binds to the IP address of the N6 interface.
3. Start a container that joins the network namespace of the UE container.
4. Run client application that binds to the IP address of the appropriate PDU session.

Sample commands for iperf3 application between dn\_cloud and imsi-001017005551002:

```bash
# extract dn_cloud IP address
DNIP=$(docker exec dn_cloud ip -j addr show n6 | jq -r '.[] | .addr_info[] | select(.family=="inet") | .local')

# start server application
docker run -d --name iperf3s --network container:dn_cloud networkstatic/iperf3 --forceflush -B $DNIP -s

# extract imsi-001017005551002 cloud PDU session IP address
UEIP=$(docker -H ssh://${CTRL_EDGE1} exec ue1001 ./nr-cli imsi-001017005551002 -e ps-list | awk '$1=="apn:" && $2=="cloud" { found=1 } found && $1=="address:" { print $2; exit }')

# run client application
docker -H ssh://${CTRL_EDGE1} run --rm --name iperf3c --network container:ue1001 networkstatic/iperf3 --forceflush -B $UEIP -c $DNIP -u -b 100M -R

# stop server application
docker rm -f iperf3s
```
