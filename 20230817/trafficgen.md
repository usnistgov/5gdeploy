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

# gather statistics
5giperf3 collect

# delete iperf3 servers and clients
5giperf3 stop
```

Statistics are written to `iperf3/*.json` for later analysis.

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
