# ns-3 Traffic Generators

It is possible to adapt certain TCP/IP based ns-3 applications for use as a traffic generator.
Some of these traffic generators are integrated as traffic flow flags of `./compose.sh tgcs` command, as introduced in [client-server traffic generators](tgcs.md).

## ns-3 3GPP HTTP applications

`--ns3http` traffic flow flag prepares [ns-3 3GPP HTTP applications](../docker/ns3http/README.md).

```bash
./compose.sh tgcs --ns3http='internet | * | --stop-time=60s --clients=1 --ns3::ThreeGppHttpVariables::ReadingTimeMean=5s'
./tg.sh
```

Each DNN can have only one ns-3 3GPP HTTP server.
If multiple traffic flow flags match the DNN, the server flags are taken from the last traffic flow flag.

The server application always runs on port 80.
Port numbers assigned by tgcs command are only used to derive NAT'ed IP address within the ns-3 network.
