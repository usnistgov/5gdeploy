# 5gdeploy/ueransim

Package **ueransim** generates [UERANSIM](https://github.com/aligungr/UERANSIM) configuration.
This package offers these choices in the **netdef-compose** command:

* `--ran=ueransim`

UERANSIM is capable of simulating multiple UEs in the same UE container, as long as they have the consecutive SUPIs and same configuration.
By default, the generated Compose context has the minimal quantity of UE containers.
Set `--ueransim-single-ue` flag to force a separate container for each UE.

## CLI console

You can access gNB or UE console with **nr-cli** command.

```bash
# list gNBs and UEs
docker exec ue1000 ./nr-cli -d

# access a gNB or UE
docker exec -it ue1000 ./nr-cli imsi-001017005551000
```
