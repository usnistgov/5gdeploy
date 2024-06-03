# 5gdeploy/free5gc

Package **free5gc** generates free5GC configuration.
This package offers these choices in the **netdef-compose** command:

* `--cp=free5gc`: free5GC control plane
* `--up=free5gc`: [free5GC Go UPF](https://github.com/free5gc/go-upf)

Before using these choices, it's necessary to run `download.sh` to download configuration templates.

Run `./compose.sh web` in the Compose context folder to view access instructions for the free5GC web console, which includes some real-time information for the core network.

## gtp5g Kernel Module

free5GC UPF and [PacketRusher](../packetrusher/README.md) depend on [gtp5g kernel module](https://github.com/free5gc/gtp5g).
The Compose file has a **gtp5g** service that compiles and loads this kernel module.
It requires the host system to have kernel headers, provided by APT package `linux-headers-generic` or `linux-headers-lowlatency`.

If a network function terminates abnormally, gtp5g kernel objects may not release properly.
To recover from this situation, either reboot the server, or run this command to manually unload and re-load the kernel module:

```bash
sudo rmmod gtp5g
sudo modprobe gtp5g
```
