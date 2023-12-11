# Traffic Generation

This page describes how to generate traffic in scenarios that feature internet/vcam/vctl Data Networks.
The same procedure is applicable to [20230817](README.md) and [20231017](../20231017/README.md).
Unless otherwise noted, the snippets should be invoked in the Compose directory such as `~/compose/20230817`.

## nmap: ping UEs from Data Networks

Count how many UEs are connected:

```bash
$(./compose.sh at dn_internet) exec dn_internet nmap -sn 10.1.0.0/24
$(./compose.sh at dn_vcam) exec dn_vcam nmap -sn 10.140.0.0/24
$(./compose.sh at dn_vctl) exec dn_vctl nmap -sn 10.141.0.0/24
```

## iperf3

Start traffic generators:

```bash
start_iperf3_ue_dn() {
  local DNN=$1
  local UEPREFIX=$2
  local UESUBNET=$3
  local PORT=$4
  shift 4
  local DNCT=dn_${DNN}
  local DNIP=$(yq ".services.$DNCT.networks.n6.ipv4_address" compose.yml)
  local CRUN=': '
  for UECT in $(yq ".services | keys | .[] | select(test(\"^$UEPREFIX\"))" compose.yml); do
    local UEIPS=$($(./compose.sh at $UECT) exec $UECT ip -j addr show to ${UESUBNET} | jq -r '.[].addr_info[].local')
    if [[ -z $UEIPS ]]; then
      continue
    fi
    for UEIP in $UEIPS; do
      $(./compose.sh at $DNCT) run -d --name iperf_${DNN}_${PORT}_s --network container:$DNCT networkstatic/iperf3 --forceflush -B $DNIP -p $PORT -s
      CRUN=$CRUN"; $(./compose.sh at $UECT) run -d --name iperf_${DNN}_${PORT}_c --network container:$UECT networkstatic/iperf3 --forceflush -B $UEIP -p $PORT --cport $PORT -c $DNIP $*"
      PORT=$((PORT+1))
    done
  done
  sleep 10
  bash -c "$CRUN"
}

start_iperf3_ue_dn vcam ue4 10.140.0.0/16 20000 -t 300 -u -b 36M
start_iperf3_ue_dn vctl ue4 10.141.0.0/16 20000 -t 300 -u -b 425K -R
start_iperf3_ue_dn internet ue1 10.1.0.0/16 20000 -t 300 -u -b 15M
start_iperf3_ue_dn internet ue1 10.1.0.0/16 21000 -t 300 -u -b 50M -R
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

For multi-host deployment:

* The start snippet can be used directly.
* The stop snippet needs to be pasted into SSH consoles of every host machine that has DN and UE containers.
* CPU isolation is not respected.

## ns-3 3GPP HTTP application

[ns-3 3GPP HTTP applications](https://www.nsnam.org/docs/release/3.35/models/html/applications.html) simulate web browsing traffic based on a commonly used 3GPP model in standardization.
See `5gdeploy/docker/ns3http/README.md` for more explanation on how this container works and its optional command line flags.

```bash
# start 3GPP HTTP server in Data Network 'internet'
$(./compose.sh at dn_internet) run -d --name ns3http_internet --cap-add=NET_ADMIN --device /dev/net/tun \
  --network container:dn_internet -e NS_LOG=ThreeGppHttpServer \
  5gdeploy.localhost/ns3http 0 n6 --listen

# start 3GPP HTTP clients in ue1000
SERVER=$(yq .services.dn_internet.networks.n6.ipv4_address compose.yml)
$(./compose.sh at ue1000) run -d --name ns3http_ue1000 --cap-add=NET_ADMIN --device /dev/net/tun \
  --network container:ue1000 -e NS_LOG=ThreeGppHttpClient \
  5gdeploy.localhost/ns3http 0 10.1.0.0/16 --connect=$SERVER --clients=10

# gather logs and stop applications
$(./compose.sh at dn_internet) logs ns3http_internet &>ns3http_internet.log
$(./compose.sh at ue1000) logs ns3http_ue1000 &>ns3http_ue1000.log
$(./compose.sh at dn_internet) rm -f ns3http_internet
$(./compose.sh at ue1000) rm -f ns3http_ue1000
```
