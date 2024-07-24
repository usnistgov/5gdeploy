# 5gdeploy.localhost/ns3http

This container image packages [ns-3 3GPP HTTP applications](https://www.nsnam.org/docs/release/3.35/models/html/applications.html) for use in 5gdeploy scenarios.
The application simulates web browsing traffic based on a commonly used 3GPP model in standardization.

The container image is meant to be launched through [ns-3 traffic generators](../../docs/ns3.md).
The same image can run as either the server side or the client side.
For both roles, the container requires `NET_ADMIN` capability and `/dev/net/tun` device, and should join the network namespace of an existing container (typically a Data Network or a UE).

The ns-3 program `main.cpp` creates an `ns3::Node` that is connected to the network namespace via a TAP network interface.
It then installs an `ns3::ThreeGppHttpServer` or `ns3::ThreeGppHttpClient` application on this node, which can communicate with the 5G network.

## Use as Server

`--listen` flag starts a 3GPP HTTP server application.
It listens on port 80 for requests from 3GPP HTTP client applications.

Optional flags:

* ns-3 attributes, see `docker run --rm 5gdeploy.localhost/ns3http ns3http --PrintAttributes=ns3::ThreeGppHttpVariables`

## Use as Client

`--connect=SERVER` flag starts 3GPP HTTP client applications and connects to the specified *SERVER*.

Optional flags:

* `--clients=N` launches *N* instances of simulated web browsers on the same UE.
  Default is 1 instance.
  Note that all these instances would appear to come from the same UE, not on different UEs.
* ns-3 attributes, see `docker run --rm 5gdeploy.localhost/ns3http ns3http --PrintAttributes=ns3::ThreeGppHttpVariables`
