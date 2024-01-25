# free5gc

Package **free5gc** generates free5GC configuration.
This package offers these choices in the **netdef-compose** command:

* `--cp=free5gc`: free5GC control plane
* `--up=free5gc`: [free5GC Go UPF](https://github.com/free5gc/go-upf)

Before using these choices, it's necessary to run `download.sh` to download configuration templates.
To use the UPF, it's necessary to run `load-gtp5g.sh` script to install [gtp5g kernel module](https://github.com/free5gc/gtp5g).
