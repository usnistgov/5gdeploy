# oai

Package **oai** generates OpenAirInterface and CN5G configurations.
This package offers these choices in the **netdef-compose** command:

* `--ran=oai`: OAI RAN simulator
  * gNB can only connect to the first AMF
* `--cp=oai`: [CN5G control plane](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed)
* `--up=oai`: [CN5G UPF](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf)
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
