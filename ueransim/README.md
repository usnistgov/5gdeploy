# 5gdeploy/ueransim

Package **ueransim** generates [UERANSIM](https://github.com/aligungr/UERANSIM) configuration.
This package offers these choices in the **netdef-compose** command:

* `--ran=ueransim`

UERANSIM is capable of simulating multiple UEs in the same UE container, as long as they have the consecutive SUPIs and same configuration.
By default, the generated Compose context has the minimal quantity of UE containers.
Set `--ueransim-single-ue` flag to force a separate container for each UE.
