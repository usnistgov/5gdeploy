# 5gdeploy/phoenix-rpc

Command **phoenix-rpc** interacts with Open5GCore network function via JSON-RPC 2.0 or UDP socket.

`--host` specifies target host.
Acceptable formats include:

* IPv4 address, such as `--host=192.0.2.1`.
* Docker container name and network name, such as `--host=amf:cp`.
* Docker container name, such as `--host=amf`, which would use the `mgmt` network.

## Remote Commands

List available commands via introspect endpoint:

```bash
# introspect over JSON-RPC
corepack pnpm -s phoenix-rpc --host=amf:cp introspect --json | jq

# introspect over UDP
corepack pnpm -s phoenix-rpc --host=amf introspect
```

Invoke a command:

```bash
corepack pnpm -s phoenix-rpc --host=amf amf.ng.print_nodes

export NO_COLOR=1 # disable ANSI colors https://no-color.org/
corepack pnpm -s phoenix-rpc --host=amf amf.ng.print_nodes
```

Warning: `phoenix` process will crash if the output does not fit in a memory chunk.

## Basic UE Control

Retrieve UE status:

```bash
corepack pnpm -s phoenix-rpc --host=ue1000 ue-status | jq
```

Register and deregister:

```bash
# register without PDU sessions
corepack pnpm -s phoenix-rpc --host=ue1000 ue-register

# register and establish PDU sessions
corepack pnpm -s phoenix-rpc --host=ue1000 ue-register --dnn=default --dnn=internet

# register and establish PDU sessions matching pattern(s)
#  This is only supported when --host refers to a Docker container.
#  The patterns should be written in minimatch-compatible syntax.
corepack pnpm -s phoenix-rpc --host=ue1000 ue-register '--dnn=*'

# deregister
corepack pnpm -s phoenix-rpc --host=ue1000 ue-deregister
```

These subcommands automatically check the UE status.
If the UE is already in the desired state, no action would be executed.
