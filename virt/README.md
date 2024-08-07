# 5gdeploy/virt

Package **virt** contains scripts to start virtual machines.

```bash
corepack pnpm -s virt --ip-space=172.25.64.0/18 \
  --vm='a | 192.168.60.2(10-19) | vmctrl@02:00:00:00:00:02,n6@02:00:00:00:06:02' \
  --vm='b | 192.168.60.3(10-19) | vmctrl@02:00:00:00:00:03,n6@02:00:00:00:06:03' \
  --vm='c | 192.168.60.3(20-29) | vmctrl@02:00:00:00:00:03,n6@02:00:00:00:06:03' \
  --ctrlif='02:00:00:00:00:01'

cd ~/compose/virt
./compose.sh up
./compose.sh keyscan
```
