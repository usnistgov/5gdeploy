# oai

Package **oai** generates OpenAirInterface and CN5G configurations.
This package offers these choices in the **netdef-compose** command:

* `--ran=oai`: OAI RAN simulator
  * gNB can only connect to the first AMF
* `--cp=oai`: [CN5G control plane](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed)
  * does not support Ethernet bridge
  * requires exactly one AMF and exactly one SMF
* `--up=oai`: [CN5G UPF](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf)
  * does not support Ethernet bridge
  * does not support N9 interface
* `--up=oai-vpp`: [UPF using a VPP implementation](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf-vpp)
  * does not support N9 interface
  * requires exactly one IPv4 Data Network
  * CPU isolation strongly recommended, currently hard-coded to 2 worker threads

## RAN simulator

`--ran=oai` uses OpenAirInterface RAN simulator in RFSimulator mode.

OpenAirInterface RAN requires libconfig format files.
The `convert.py` script is used for converting between libconfig and tagged JSON.
It requires an additional package dependency:

```bash
sudo apt install python3-libconf
```

## Advanced Options

This package adds several OAI-specific options to the **netdef-compose** command.

`--oai-upf-workers` specifies CPU cores reserved for each UPF.
These should be used together with CPU isolation via `--place` flag.

`--oai-upf-bpf=true` selects BPF datapath in CN5G UPF.
The default is using the userspace implementation.
