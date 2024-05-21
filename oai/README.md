# 5gdeploy/oai

Package **oai** generates OpenAirInterface and CN5G configurations.
This package offers these choices in the **netdef-compose** command:

* `--ran=oai`: [OpenAirInterface5G](https://gitlab.eurecom.fr/oai/openairinterface5g)
  * runs in either RFSimulator mode (very slow) or with USRP hardware (gNB only)
  * UE can only establish one PDU session
* `--cp=oai`: [CN5G control plane](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed)
  * does not support Ethernet bridge
  * requires exactly one AMF and exactly one SMF
* `--up=oai`: [CN5G UPF](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf)
  * does not support Ethernet bridge
  * does not support N9 interface
* `--up=oai-vpp`: [UPF using a VPP implementation](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf-vpp)
  * does not support Ethernet bridge
  * does not support N9 interface
  * requires exactly one IPv4 Data Network
  * CPU isolation strongly recommended, currently supports up to 8 worker threads

## Advanced Options

This package adds several OAI-specific options to the **netdef-compose** command.

`--oai-upf-workers` specifies CPU cores reserved for each UPF.
These should be used together with CPU isolation via `--place` flag.

`--oai-upf-bpf=true` selects BPF datapath in CN5G UPF.
The default is using the userspace implementation.

`--oai-gnb-conf` specifies template config file for gNB.
`--oai-ue-conf` specifies template config file for UE.
It's advised to use absolute paths for these options.

## USRP hardware

`--oai-gnb-usrp=b2xx` enables USRP B2xx hardware in the gNB.
This should be used together with `--oai-gnb-conf` to import a config file with radio parameters.

USRP firmware is mounted from `/usr/local/share/uhd/images` on the host machine.
Run this command to download the firmware:

```bash
docker run --rm --entrypoint='' -e PYTHONUNBUFFERED=1 -v /usr/local/share/uhd/images:/usr/local/share/uhd/images \
  oaisoftwarealliance/oai-gnb:develop /opt/oai-gnb/bin/uhd_images_downloader.py
```

## UPF-VPP status

Here are some commands to show status of UPF-VPP:

```bash
# show PFCP associations with SMF
docker exec upf1 bin/vppctl show upf association

# show PFCP sessions i.e. GTP tunnels
docker exec upf1 bin/vppctl show upf session
```
