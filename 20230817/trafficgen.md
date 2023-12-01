# Traffic Generation

This page describes how to generate traffic in scenarios that feature internet/vcam/vctl Data Networks.
The same procedure is applicable to [20230817](README.md) and [20231017](../20231017/README.md).

## nmap: ping UEs from Data Networks

Count how many UEs are connected:

```bash
docker exec dn_internet nmap -sn 10.1.0.0/24
docker exec dn_vcam nmap -sn 10.140.0.0/24
docker exec dn_vctl nmap -sn 10.141.0.0/24
```

## iperf3

Start traffic generators:

```bash
start_iperf3_ue_dn() {
  local DNN=$1
  local UESUBNET=$2
  local PORT=$3
  shift 3
  local DNCT=dn_${DNN}
  local DNIP=$(docker exec $DNCT ip -j route get ${UESUBNET%/*} | jq -r '.[0].prefsrc')
  local CRUN=': '
  for UECT in $(docker ps -a --format='{{.Names}}' | grep '^ue[0-9]'); do
    local UEIPS=$(docker exec $UECT ip -j addr show to ${UESUBNET} | jq -r '.[].addr_info[].local')
    if [[ -z $UEIPS ]]; then
      continue
    fi
    for UEIP in $UEIPS; do
      docker run -d --name iperf_${DNN}_${PORT}_s --network container:$DNCT networkstatic/iperf3 --forceflush -B $DNIP -p $PORT -s
      CRUN=$CRUN"; docker run -d --name iperf_${DNN}_${PORT}_c --network container:$UECT networkstatic/iperf3 --forceflush -B $UEIP -p $PORT --cport $PORT -c $DNIP $*"
      PORT=$((PORT+1))
    done
  done
  sleep 10
  bash -c "$CRUN"
}

start_iperf3_ue_dn vcam 10.140.0.0/16 20000 -t 300 -u -b 7M
start_iperf3_ue_dn vctl 10.141.0.0/16 20000 -t 300 -u -b 50K -R
start_iperf3_ue_dn internet 10.1.0.0/16 20000 -t 300 -u -b 15M
start_iperf3_ue_dn internet 10.1.0.0/16 21000 -t 300 -u -b 50M -R
```

Stop traffic generators:

```bash
# stop and gather logs
for CT in $(docker ps -a --format='{{.Names}}' | grep '^iperf_' | sort -V); do
  echo '----------------------------------------------------------------'
  echo $CT
  docker kill --signal=INT $CT
  docker logs $CT
  docker rm -f $CT
done &>iperf3.log

# stop without gathering logs
docker rm -f $(docker ps -a --format='{{.Names}}' | grep '^iperf_')
```

In a multi-host deployment, DN and UE containers may be placed on different machines.
It is still possible to run iperf3 traffic generation, but the above snippets will not work directly.

## ns-3 3GPP HTTP application

[ns-3 3GPP HTTP applications](https://www.nsnam.org/docs/release/3.35/models/html/applications.html) simulate web browsing traffic based on a commonly used 3GPP model in standardization.
See `5gdeploy/docker/ns3http/README.md` for more explanation on how this container works and its optional command line flags.

```bash
# start 3GPP HTTP server in Data Network 'internet'
docker run -d --name ns3http_internet --cap-add=NET_ADMIN --device /dev/net/tun \
  --network container:dn_internet -e NS_LOG=ThreeGppHttpServer \
  5gdeploy.localhost/ns3http 0 n6 --listen

# start 3GPP HTTP clients in ue1000
SERVER=$(docker exec dn_internet ip -j route get 10.1.0.0 | jq -r '.[0].prefsrc')
docker run -d --name ns3http_ue1000 --cap-add=NET_ADMIN --device /dev/net/tun \
  --network container:ue1000 -e NS_LOG=ThreeGppHttpClient \
  5gdeploy.localhost/ns3http 0 10.1.0.0/16 --connect=$SERVER --clients=10

# gather logs and stop applications
docker logs ns3http_internet &>ns3http_internet.log
docker logs ns3http_ue1000 &>ns3http_ue1000.log
docker rm -f ns3http_internet ns3http_ue1000
```

In a multi-host deployment, DN and UE containers may be placed on different machines.
In this case, it is necessary to insert `-H ssh://host` flag to these commands for accessing the remote Docker Engines.
