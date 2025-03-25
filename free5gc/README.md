# 5gdeploy/free5gc

Package **free5gc** generates free5GC configuration.
This package offers these choices in the **netdef-compose** command:

* `--cp=free5gc`: [free5GC control plane](https://github.com/free5gc/free5gc)
* `--up=free5gc`: [free5GC Go UPF](https://github.com/free5gc/go-upf)

Run `./compose.sh web` in the Compose context folder to view access instructions for the free5GC web console, which includes some real-time information for the core network.

## Advanced Options

This package adds several free5GC-specific options to the **netdef-compose** command.

`--free5gc-tag` specifies Docker image tag for CP and UP functions.
The default is gathered from free5gc-compose repository checkout.
A useful value is `--free5gc-tag=latest` to make use of free5GC daily builds.

## gtp5g Kernel Module

Both free5GC UPF and [PacketRusher](../packetrusher/README.md) depend on [gtp5g kernel module](https://github.com/free5gc/gtp5g).
The Compose file has a **gtp5g** service that compiles and loads this kernel module.
It requires the host system to have kernel headers, provided by APT package `linux-headers-generic` or `linux-headers-lowlatency`.

Note that the gtp5g service will not work in [KVM guests](../virt/README.md), because the KVM guest is running Debian 12 while the gtp5g service is designed for Ubuntu 22.
Instead, the KVM guest preloads the gtp5g kernel module.
Upon detecting the presence of this kernel module, the gtp5g service will not attempt to compile the module by itself.

If a network function terminates abnormally, gtp5g kernel objects may not release properly.
To recover from this situation, either reboot the host, or run this command to manually unload and re-load the kernel module:

```bash
sudo sh -c 'rmmod gtp5g; modprobe gtp5g'
# omit 'sudo' in KVM guest
```

### gtp5g Options

`--gtp5g-dbg` sets gtp5g kernel module log level.
These logs can be viewed with `sudo journalctl --dmesg --grep gtp5g --follow` command.

`--gtp5g-qos` enables/disables QoS feature in gtp5g kernel module.
`--gtp5g-seq` enables/disables GTP-U sequence number feature in gtp5g kernel module.

The above flags are applied every time the gtp5g service is started, including when it's running in KVM guest.
Changing them does not need reboots or module re-loading.
