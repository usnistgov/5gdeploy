# 5gdeploy/omec

Package **omec** generates Open Mobile Evolved Core / Aether / SD-Core configurations.
This package offers these choices in the **netdef-compose** command:

* `--ran=gnbsim`: [gNBSim](https://github.com/omec-project/gnbsim) RAN simulator
  * gNB can only connect to the first AMF
  * signaling only, no PDU session
  * "deregister" profile: Registration + UE initiated PDU Session Establishment + User Data packets + Deregister
* `--up=bess`: [BESS-UPF](https://github.com/omec-project/upf) v2.0.1

## BESS-UPF Details

BESS-UPF is not installed automatically.
Run `bash omec/download.sh` to download the source code and build the container images.

BESS-UPF only supoorts one Data Network per UPF.
If an UPF is connected to multiple DNs, only the last DN would work.
This is because `route_control.py` does not support `ip rule` policy routing.

## BESS-UPF Options

`--bess-workers` specifies number of worker threads in each UPF.
The default is 2 worker threads.
