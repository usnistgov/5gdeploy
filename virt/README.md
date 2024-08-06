# 5gdeploy/virt

Package **virt** contains scripts to start virtual machines.

```bash
corepack pnpm -s virt --ip-space=172.25.64.0/18 \
  --vm='b2 | 192.168.60.2(10-15) | vmctrl@02:00:00:00:00:02,n6@02:00:00:00:06:02' \
  --vm='c3 | 192.168.60.3(16-21) | vmctrl@02:00:00:00:00:03,n6@02:00:00:00:06:03' \
  --vm='c4 | 192.168.60.4(22-27) | vmctrl@02:00:00:00:00:03,n6@02:00:00:00:06:03' \
  --ctrlif='02:00:00:00:00:01'
```
