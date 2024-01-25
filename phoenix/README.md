# phoenix

Package **phoenix** reads and writes Open5GCore configuration files.

* `ipmap.ts`: interpret ph\_init `ip-map` file
* `other.ts`: interpret ph\_init `other` file
* `nf.ts`: edit network function JSON
* `folder.ts`: copy scenario folder with edits
* `netdef.ts`: apply a [network definition](../netdef) to a scenario folder

This package offers these choices in the **netdef-compose** command:

* `--cp=phoenix`
* `--up=phoenix`
* `--ran=phoenix`
  * allows up to two S-NSSAIs
  * UE does not register automatically, use [phoenix-rpc](../phoenix-rpc) to perform UE registration

## netdef-compose Options

This package adds several phoenix-specific options to the **netdef-compose** command.

`--phoenix-upf-workers` specifies number of worker threads in each UPF.
`--phoenix-gnb-workers` specifies number of worker threads in each gNB.
These should be used together with CPU isolation via `--place` flag.

`--phoenix-upf-xdp=true` selects XDP-based datapath in UPF.
The default is using the userspace implementation.

`--phoenix-ue-isolated` specifies which UEs shall have a reserved CPU core.
Open5GCore UE simulator is only involved in registration and PDU session setup.
After that, each PDU session is present in the container as a GRE tunnel interface, and user traffic does not pass through the UE simulator.
Having a reserved CPU core is mostly helpful for other processes running inside the UE container, such as iperf3 client, to inherit CPU isolation.
This option is specified as a list of SUPI suffixes.
The default is an empty string, which is a suffix of every SUPI, and this gives every UE container a reserved CPU core.
To disable reserved CPU cores, set this option to "NONE", which would not be a suffix of any SUPI.
