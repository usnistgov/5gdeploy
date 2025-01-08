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
Instead, the KVM guest preloads the gtp5g kernel module, and the gtp5g service will do nothing upon detecting the presence of this kernel module.

If a network function terminates abnormally, gtp5g kernel objects may not release properly.
To recover from this situation, either reboot the host, or run this command to manually unload and re-load the kernel module:

```bash
sudo rmmod gtp5g
sudo modprobe gtp5g
# omit 'sudo' in KVM guest
```
