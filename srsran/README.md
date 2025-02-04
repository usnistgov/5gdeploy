# 5gdeploy/srsran

Package **srsran** generates [srsRAN](https://docs.srsran.com/projects/project/en/latest/tutorials/source/srsUE/source/index.html) configuration.
This package offers these choices in the **netdef-compose** command:

* `--ran=srsran`
  * There must be exactly one UE connected to each gNB.
  * The UE can only establish one PDU session, see [PacketRusher](../packetrusher/README.md) "UE Single DN option" on how it's chosen.

## USRP hardware

`--oai-gnb-sdr=` specifies template config file for gNB.
Only `.ru_sdr` and `.cell_cfg` sections are considered; other sections are ignored.
This allows creating a physical gNB with USRP hardware.

srsGNB container has a copy of USRP firmware, so that firmware download is unnecessary.
