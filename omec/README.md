# omec

Package **omec** generates Open Modile Evolved Core / Aether / SD-Core configurations.
This package offers these choices in the **netdef-compose** command:

* `--ran=gnbsim`: [gNBSim](https://github.com/omec-project/gnbsim) RAN simulator
  * gNB can only connect to the first AMF
  * "deregister" profile: Registration + UE initiated PDU Session Establishment + User Data packets + Deregister
