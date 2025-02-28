# 5gdeploy/open5gs

Package **open5gs** generates [Open5GS](https://open5gs.org/) configurations.
This package offers these choices in the **netdef-compose** command:

* `--cp=open5gs`: Open5GS Control Plane
  * Subscribed UE AMBR is supported but it's also applied to the first Data Network.
  * Session AMBR is not supported.
  * SMF does not work properly if UPF lacks FTUP feature.
* `--up=open5gs`: Open5GS UPF
  * N9 interface is not supported.
  * Ethernet PDU session is not supported.
  * IPv6 PDU session is allowed but untested.

## Advanced Options

This package adds several Open5GS-specific options to the **netdef-compose** command.

`--o5g-loglevel` specifies log level of Open5GS network functions.
