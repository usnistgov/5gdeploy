# 5gdeploy/oai

Package **oai** generates OpenAirInterface and CN5G configurations.
This package offers these choices in the **netdef-compose** command:

* `--ran=oai`: [OpenAirInterface5G](https://gitlab.eurecom.fr/oai/openairinterface5g)
  * runs in either RFSimulator mode (very slow) or with USRP hardware (gNB only)
  * gNB supports Ethernet bridge only if `--oai-ran-tag` is unset
  * UE can only establish one PDU session
* `--cp=oai`: [CN5G control plane](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed)
  * does not support Ethernet bridge
  * requires exactly one AMF and exactly one SMF
* `--up=oai`: [CN5G UPF](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf)
  * does not support N9 interface
  * supports Ethernet bridge only if `--oai-cn5g-tag` is unset
* `--up=oai-vpp`: [UPF using a VPP implementation](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf-vpp)
  * does not support Ethernet bridge
  * does not support N9 interface
  * requires exactly one IPv4 Data Network
  * CPU isolation strongly recommended, currently supports up to 8 worker threads

## Advanced Options

This package adds several OAI-specific options to the **netdef-compose** command.

`--oai-cn5g-tag` specifies Docker image tag for core network functions.
`--oai-ran-tag` specifies Docker image tag for RAN functions.
The default is gathered from oai-cn5g-fed repository checkout.

`--oai-cn5g-nrf=false` disables Network Repository Function (NRF) globally.
The default is using NRF, which includes UPF discovery by SMF.

`--oai-cn5g-nwdaf=true` enables Network Data Analytics Function (NWDAF).
Currently only the SBI microservice works; other microservices are not working.

`--oai-upf-workers` specifies CPU cores reserved for each UPF.
These should be used together with CPU isolation via `--place` flag.

`--oai-upf-bpf=true` selects BPF datapath in CN5G UPF.
The default is using the userspace implementation.

`--oai-gnb-conf` specifies template config file for gNB.
`--oai-ue-conf` specifies template config file for UE.
It's advised to use absolute paths for these options.

## RAN telnet

Both gNB and UE have telnet server listening on `mgmt` network port 9090.
To access the telnet server:

```bash
CT=gnb0
IP=$(yq ".services.$CT.annotations[\"5gdeploy.ip_mgmt\"]" compose.yml)
docker run -it --rm --network host str0ke/telnet $IP 9090
```

## USRP hardware

`--oai-gnb-usrp=b2xx` enables USRP B2xx hardware in the gNB.
This should be used together with `--oai-gnb-conf` to import a config file with radio parameters.

USRP firmware is mounted from `/usr/local/share/uhd/images` on the host machine.
Run this command to download the firmware:

```bash
docker run --rm --entrypoint='' -e PYTHONUNBUFFERED=1 -v /usr/local/share/uhd/images:/usr/local/share/uhd/images \
  oaisoftwarealliance/oai-gnb:develop /opt/oai-gnb/bin/uhd_images_downloader.py
```

## RAN configuration comparison

`confdiff.ts` is a script to compare two libconf files.
It's mainly useful for finding out the difference between two gNB configuration files.

```bash
$(env -C ~/5gdeploy corepack pnpm bin)/tsx ~/5gdeploy/oai/confdiff.ts A.conf B.conf
```

The output is given in [JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902) format.
In most cases, each changed value has a `test` operation with the old value and a `replace` operation with the new value.

## UPF-VPP status

Here are some commands to show status of UPF-VPP:

```bash
# show PFCP associations with SMF
docker exec upf1 bin/vppctl show upf association

# show PFCP sessions i.e. GTP tunnels
docker exec upf1 bin/vppctl show upf session
```
