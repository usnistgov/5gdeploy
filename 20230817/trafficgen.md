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

Define traffic generators:

```bash
alias 5giperf3='~/5gdeploy-scenario/20230817/iperf3.sh'
5giperf3 init
5giperf3 add vcam "^ue4" 10.140.0.0/16 20000 -t 300 -u -b 36M
5giperf3 add vctl "^ue4" 10.141.0.0/16 20000 -t 300 -u -b 425K -R
5giperf3 add internet "^ue1" 10.1.0.0/16 20000 -t 300 -u -b 15M
5giperf3 add internet "^ue1" 10.1.0.0/16 21000 -t 300 -u -b 50M -R
```

Run traffic generators:

```bash
# start iperf3 servers
5giperf3 servers; sleep 5

# start iperf3 clients
5giperf3 clients

# wait for iperf3 clients to finish
5giperf3 wait

# gather statistics into iperf3/*.json
5giperf3 collect

# delete iperf3 servers and clients
5giperf3 stop
```

Analyze the results:

```bash
# show per-flow statistics
5giperf3 iperf3/*_c.json

# show total throughput (Mbps) per traffic kind
# vcam uplink, vctl downlink, internet uplink, internet downlink
for P in vcam_20 vctl_20 internet_20 internet_21; do
  echo $P $(5giperf3 total iperf3/$P*_c.json)
done
```

Statistics are written to `iperf3/*.json` for analysis.

## ns-3 3GPP HTTP application

[ns-3 3GPP HTTP applications](https://www.nsnam.org/docs/release/3.35/models/html/applications.html) simulate web browsing traffic based on a commonly used 3GPP model in standardization.
See `5gdeploy/docker/ns3http/README.md` for more explanation on how this container works and its optional command line flags.

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
