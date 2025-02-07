# 5gdeploy/oai

Package **oai** generates OpenAirInterface and CN5G configurations.
This package offers these choices in the **netdef-compose** command:

* `--ran=oai`: [OpenAirInterface5G](https://gitlab.eurecom.fr/oai/openairinterface5g)
  * RAN runs in either RFSimulator mode (very slow) or with USRP hardware (gNB only).
  * gNB crashes upon receiving RerouteNASRequest.
  * UE can only establish one PDU session, see [PacketRusher](../packetrusher/README.md) "UE Single DN option" on how it's chosen.
* `--cp=oai`: [CN5G control plane](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed)
  * SMF does not support Ethernet bridge.
  * CP requires exactly one AMF and exactly one SMF.
* `--up=oai`: [CN5G UPF](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf)
  * This UPF does not support N9 interface.
* `--up=oai-vpp`: [UPF using a VPP implementation](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf-vpp)
  * This UPF must have either N3+N6 or N3+N9 or N9+N6.
  * CPU isolation is strongly recommended, expecting 2 cores for main and worker.
  * If the UPF receives an IPv6 packet, it would reply with a malformed T-PDU, which then causes the gNB to stop transmitting over the PDU session.

## Advanced Options

This package adds several OAI-specific options to the **netdef-compose** command.

`--oai-cn5g-tag` specifies Docker image tag for core network functions.
`--oai-ran-tag` specifies Docker image tag for RAN functions.
The default is extracting from oai-cn5g-fed repository checkout.

`--oai-cn5g-nrf=false` disables Network Repository Function (NRF).
The default is enabling NRF, which includes UPF discovery by SMF.

`--oai-cn5g-pcf=true` enables Policy Control Function (PCF).
PCF supplies Data Network Access Identifier (DNAI) information to the SMF, which allows precise definition of User Plane topology.
This is only compatible with OAI-CN5G-UPF-VPP.
The default is disabling PCF and DNAI.

`--oai-cn5g-nwdaf=true` enables Network Data Analytics Function (NWDAF).
Docker images must be built manually with `./docker/build.sh oai-nwdaf`.
NBI analytics endpoint is working; Machine Learning related microservices are not working.

`--oai-upf-workers` specifies CPU cores reserved for each UPF.
These should be used together with CPU isolation via `--place` flag.

`--oai-upf-bpf=true` selects BPF datapath in CN5G UPF.
The default is using the Simple Switch implementation.

`--oai-gnb-conf` specifies template config file for gNB (libconfig format only).
`--oai-ue-conf` specifies template config file for UE (libconfig format only).
It's advised to use absolute paths for these options.
If the scenario has multiple gNBs that require different config, `--oai-gnb-conf` may be specified as a directory that contains `gnb0.conf`, `gnb1.conf`, etc.

## RAN telnet

Both gNB and UE have telnet server listening on `mgmt` network port 9090.
To access the telnet server:

```bash
CT=gnb0
IP=$(yq ".services.$CT.annotations[\"5gdeploy.ip_mgmt\"]" compose.yml)
docker run -it --rm --network host str0ke/telnet $IP 9090
```

## USRP hardware

`--oai-gnb-usrp=b2xx` enables USRP B2xx hardware in the gNB; this would disable all UE simulators.
This should be used together with `--oai-gnb-conf` to import a config file with radio parameters.
If there are multiple gNBs, you may specify `--oai-gnb-conf` as a directory so that each USRP can have different radio parameters.

USRP firmware is mounted from `/usr/local/share/uhd/images` on the host machine.
Run this command to download the firmware:

```bash
docker run --rm --entrypoint='' -e PYTHONUNBUFFERED=1 -v /usr/local/share/uhd/images:/usr/local/share/uhd/images \
  oaisoftwarealliance/oai-gnb:develop /opt/oai-gnb/bin/uhd_images_downloader.py
```

Run this command to detect USRP devices:

```bash
docker run --rm --entrypoint='' --device /dev/bus/usb -v /usr/local/share/uhd/images:/usr/local/share/uhd/images:ro \
  oaisoftwarealliance/oai-gnb:develop uhd_find_devices
```

## RAN configuration comparison

`confdiff.ts` is a script to compare two libconfig or YAML files.
It's mainly useful for finding the difference between two gNB configuration files.

```bash
alias confdiff="$(env -C ~/5gdeploy corepack pnpm bin)/tsx ~/5gdeploy/oai/confdiff.ts"

confdiff A.conf B.conf
confdiff A.conf B.yaml
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
