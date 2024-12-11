# 5gdeploy/open5gs

Package **open5gs** generates [Open5GS](https://open5gs.org/) configurations.
This package offers these choices in the **netdef-compose** command:

* `--cp=open5gs`: Open5GS Control Plane
  * each S-NSSAI must have exactly one DNN
* `--up=open5gs`: Open5GS UPF
  * does not support Ethernet bridge
  * does not support N9 interface
  * IPv6 is enabled but untested

The container image is not built by default.
To build the image:

```bash
cd ~/5gdeploy
./docker/build.sh open5gs
```
