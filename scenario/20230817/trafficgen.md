# Traffic Generation

This page describes how to generate traffic in scenarios that feature internet/vcam/vctl Data Networks.
The same procedure is applicable to [20230817](README.md), [20231017](../20231017/README.md), and [20231214](../20231214/README.md).
Unless otherwise noted, the snippets should be invoked in the Compose directory such as `~/compose/20230817`.

## nmap and iperf3

See [trafficgen](../../trafficgen/README.md).

## ns-3 3GPP HTTP application

[ns-3 3GPP HTTP applications](https://www.nsnam.org/docs/release/3.35/models/html/applications.html) simulate web browsing traffic based on a commonly used 3GPP model in standardization.
See [ns3http Docker image README](../../docker/ns3http/README.md) for more explanation on how this container works and its optional command line flags.

```bash
# define variables
INDEX=0
DNN=internet
DNCT=dn_${DNN}
DNIP=$(yq .services.$DNCT.networks.n6.ipv4_address compose.yml)
DNCPUSET=$(yq .services.$DNCT.cpuset compose.yml)
UECT=ue1000
UESUBNET=10.1.0.0/16
UECPUSET=$(yq .services.$UECT.cpuset compose.yml)
UECOUNT=10

# start 3GPP HTTP server in Data Network
$(./compose.sh at $DNCT) run -d --name ns3http_${DNN} --cap-add=NET_ADMIN --device /dev/net/tun \
  $([[ -n $DNCPUSET ]] && echo --cpuset-cpus=$DNCPUSET) \
  --network container:$DNCT -e NS_LOG=ThreeGppHttpServer \
  5gdeploy.localhost/ns3http $INDEX n6 --listen

# start 3GPP HTTP clients
$(./compose.sh at $UECT) run -d --name ns3http_${UECT} --cap-add=NET_ADMIN --device /dev/net/tun \
  $([[ -n $UECPUSET ]] && echo --cpuset-cpus=$UECPUSET) \
  --network container:$UECT -e NS_LOG=ThreeGppHttpClient \
  5gdeploy.localhost/ns3http $INDEX $UESUBNET --connect=$DNIP --clients=$UECOUNT

# gather logs and stop applications
$(./compose.sh at $DNCT) logs ns3http_${DNN} &>ns3http_${DNN}.log
$(./compose.sh at $UECT) logs ns3http_${UECT} &>ns3http_${UECT}.log
$(./compose.sh at $DNCT) rm -f ns3http_${DNN}
$(./compose.sh at $UECT) rm -f ns3http_${UECT}
```
