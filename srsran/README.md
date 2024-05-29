# 5gdeploy/srsran

Package **srsran** generates [srsRAN](https://docs.srsran.com/projects/project/en/latest/tutorials/source/srsUE/source/index.html) configuration.
This package offers these choices in the **netdef-compose** command:

* `--ran=srsran`
  * There must be exactly one UE connected to each gNB.
  * The UE can only establish one PDU session.

When srsUE establishes a PDU session, it creates a network interface in the container but does not add a routing entry.
Run this command to add the routing entry:

```bash
docker exec ue0 ip route add default dev tun_srsue
```

## USRP hardware

`--oai-gnb-sdr=` specifies template config file for gNB.
Only `.ru_sdr` and `.cell_cfg` sections are considered; other sections are ignored.
This allows creating a physical gNB with USRP hardware.

See [OAI](../oai/README.md) for how to download USRP firmware.
