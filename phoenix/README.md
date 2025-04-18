# 5gdeploy/phoenix

Package **phoenix** reads and writes Open5GCore v7.4.3 configuration files.

* `nf.ts`: edit network function JSON
* `netdef.ts`: apply a [network definition](../netdef) to a scenario folder

Open5GCore is proprietary software and is not automatically installed.
To use Open5GCore, you must clone its repository at `~/phoenix-repo`, and build the Docker image:

```bash
cd ~/5gdeploy
./docker/build.sh phoenix
```

This package offers these choices in the **netdef-compose** command:

* `--cp=phoenix`
* `--up=phoenix`
* `--ran=phoenix`
  * allows up to two S-NSSAIs
  * UE does not register automatically, use [phoenix-rpc](../phoenix-rpc) to perform UE registration

This package adds several phoenix-specific options to the **netdef-compose** command, described in the next sections.

## CP Options

`--phoenix-pcf=true` enables Policy Control Function (PCF).
Default is disabled.

## UPF Data Plane and Worker Threads

Open5GCore UPF has two data plane implementations: userspace and XDP.

* `--phoenix-upf-xdp=false` (default) selects the userspace data plane.
* `--phoenix-upf-xdp=true` selects the XDP data plane.

`--phoenix-upf-workers` specifies number of worker threads in each UPF.
The default is 3 worker threads.

Each network interface can be set to either single\_thread mode or thread\_pool mode.
For each network interface in single\_thread mode, a worker thread is designated to serve all traffic arriving on this interface.
The remaining worker threads are kept in a thread pool to serve traffic arriving on all other network interfaces.
By default, N3 is in single\_thread mode, while N9 and N6 are in thread\_pool mode (with 3 total worker threads, this effectively means N9 and N6 are sharing two worker threads in the thread pool).
You can change them via `--phoenix-upf-single-worker-n3|n9|n6` flags.

When used with [CPU isolation](../docs/multi-host.md), CPU affinity is applied to UPF threads, such that (1) each worker thread handling user traffic is assigned to a separate core (2) all non-worker threads in the UPF share a set of shared cores.
This means the UPF container would request *W*+*S* dedicated CPU cores, where *W* is the number of worker threads and *S* is the number of shared cores.
This feature can be customized with these flags:

* `--phoenix-upf-taskset=shhi` (default) selects the highest-numbered core as shared core.
* `--phoenix-upf-taskset=shlo` selects the lowest-numbered core as shared core.
* `--phoenix-upf-taskset=shhi:`*S* or `--phoenix-upf-taskset=shlo:`*S* selects *S* highest/lowest-numbered cores as shared core.
* `--phoenix-upf-taskset=none` disables CPU affinity.

### XDP Cleanup

If (1) UPF is configured to use XDP data plane implementation (2) physical Ethernet adapter is moved into UPF container (3) UPF terminates abnormally, the XDP program may not unload properly.
To recover from this situation, either reboot the server, or run this command to manually unload all XDP programs:

```bash
ip -j link | jq -r '.[] | select(.xdp) | .ifname' | xargs -r -I{} \
  sudo ip link set {} xdp off
```

## RAN Options

`--phoenix-gnb-workers` specifies number of worker threads in each gNB.
The default is 2 worker threads.
This also determines how many dedicated CPU cores are requested for the gNB, when used with [CPU isolation](../docs/multi-host.md) feature.

Use [`--set-dscp` flag](../netdef-compose/README.md) to configure DSCP field for gNB-to-UPF traffic.
This is used in conjunction with SONiC QoS scripts for uplink QoS classification.

`--phoenix-ue-isolated` specifies which UEs shall have a reserved CPU core.
Open5GCore UE simulator is only involved in registration and PDU session setup.
After that, each PDU session is present in the container as a GRE tunnel interface, and user traffic does not pass through the UE simulator.
Having a reserved CPU core is mostly helpful for other processes running inside the UE container, such as iperf3 client, to inherit CPU isolation.
This option is specified as a list of SUPI suffixes.
The default is an empty string, which is a suffix of every SUPI, and thus gives every UE container a reserved CPU core.
To disable reserved CPU cores, set this option to "NONE", which would not be a suffix of any SUPI.
