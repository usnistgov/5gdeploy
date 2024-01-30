# phoenix-rpc

Command **phoenix-rpc** interacts with Open5GCore network function via JSON-RPC 2.0 or UDP socket.

`--host` specifies target host.
Acceptable formats include:

* IPv4 address, such as `--host=192.0.2.1`.
* Docker container name and network name, such as `--host=amf:cp`.
* Docker container name, such as `--host=amf`, which would use the `mgmt` network.

## Remote Command Execution

```bash
# introspect NF commands over UDP
corepack pnpm -s phoenix-rpc --host=amf introspect

# introspect NF commands over JSON-RPC
corepack pnpm -s phoenix-rpc --host=amf:cp introspect --json | jq
```

## UE Control

```bash
# retrieve UE status
corepack pnpm -s phoenix-rpc --host=ue1000 ue-status | jq

# register without PDU sessions
corepack pnpm -s phoenix-rpc --host=ue1000 ue-register

# register and establish PDU sessions
corepack pnpm -s phoenix-rpc --host=ue1000 ue-register --dnn=default --dnn=internet

# register and establish PDU sessions matching pattern(s)
#  This is only supported when --host refers to a Docker container.
#  The patterns should be written in minimatch-compatible syntax.
corepack pnpm -s phoenix-rpc --host=ue1000 ue-register "--dnn=*"

# deregister UE
corepack pnpm -s phoenix-rpc --host=ue1000 ue-deregister
```

Both `un-register` and `ue-deregister` subcommands check the current UE status.
If the UE is already in the desired status, it would not execute the action.
