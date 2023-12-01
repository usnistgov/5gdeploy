# 5gdeploy.localhost/ns3http

This container image packages [ns-3 3GPP HTTP applications](https://www.nsnam.org/docs/release/3.35/models/html/applications.html) for use in 5gdeploy scenarios.
The application simulates web browsing traffic based on a commonly used 3GPP model in standardization.

The same container can run as either the server side or the client side.
In either case, the container requires `NET_ADMIN` capability and `/dev/net/tun` device, and should join the network namespace of an existing container (typically a Data Network or a UE).

The entrypoint script accepts two positional arguments:

1. An index number between 0 and 255.
   This will be used to derive a TAP network interface name and its internal IPv4 address.
   If multiple containers are attached to the same DN/UE container, their index numbers must be unique.
2. A parent interface, written as a network interface name, IPv4 address, or IPv4 subnet.
   This shall refer to either a network interface in the network namespace (typically the N6 interface or PDU session).
   The entrypoint script will wait for the network interface to appear, and then setup full-cone NAT between it and the `ns3::Node` running the application.
3. Subsequent arguments are passed to the ns-3 program.

The ns-3 program `main.cpp` creates an `ns3::Node` that is connected to the network namespace via a TAP network interface.
It then installs an `ns3::ThreeGppHttpServer` or `ns3::ThreeGppHttpClient` application on this node, which can communicate with the 5G network.

Example command to run the server side:

```bash
docker run -d --name ns3http_internet --cap-add=NET_ADMIN --device /dev/net/tun \
  --network container:dn_internet -e NS_LOG=ThreeGppHttpServer \
  5gdeploy.localhost/ns3http 0 n6 --listen
```

Example command to run the client side:

```bash
docker run -d --name ns3http_ue1000 --cap-add=NET_ADMIN --device /dev/net/tun \
  --network container:ue1000 -e NS_LOG=ThreeGppHttpClient \
  5gdeploy.localhost/ns3http 0 192.168.60.0/24 --connect=192.168.15.45
```

Optional flags:

* `--clients=5` flag (client side only) launches 5 instances of simulated web browser on the same UE (default is 1 instance).
  You can change this number to launch more web browser instances, but all these instances would appear to come from the same UE.
  If you want to see traffic from multiple UEs, you'll need to launch more client containers associated to different UE containers or PDU sessions.
* ns-3 attributes, such as attributes of [ThreeGppHttpVariables](https://www.nsnam.org/docs/release/3.35/doxygen/classns3_1_1_three_gpp_http_variables.html), can be specified for both client and server.
  For example, `--ns3::ThreeGppHttpVariables::ReadingTimeMean=5s`.

Some UE simulators (e.g. UERANSIM) can simulate multiple UEs in the same UE container, with each UE's PDU sessions appearing as distinct network interfaces.
In this case, if the parent interface is written as an IPv4 subnet (e.g. `192.168.60.0/24`), the first matching interface would be selected, which may belong to any of the UEs.
If you want to ensure the client is bound to a specific UE, you should write the parent interface as a network interface name (e.g. `pdu1`) or an IPv4 address (e.g. `192.168.60.1`).
