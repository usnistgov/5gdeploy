#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source _common.sh

INDEX=$1
VMHOST=$2
HOSTMAC=$3
IHEX=$(printf %02x $INDEX)

DOCKERH=docker
if [[ -n $VMHOST ]]; then
  DOCKERH="docker -H ssh://$VMHOST"
fi
$DOCKERH rm -f vm$INDEX
$DOCKERH run -dit --name vm$INDEX \
  $QEMU_INVOKE bash -c "
    set -euo pipefail

    pipework --wait -i vmctrl
    ip addr flush vmctrl
    ip link add link vmctrl name macvtap0 type macvtap mode bridge
    ip link set macvtap0 up address $VM_MAC$IHEX
    IFS=: read MAJOR MINOR < <(cat /sys/devices/virtual/net/macvtap0/tap*/dev)
    mknod -m 0666 /dev/macvtap0 c \$MAJOR \$MINOR

    yasu \$(stat -c %u vm$INDEX.qcow2):\$(stat -c %g /dev/kvm) qemu-system-x86_64 \
      -name vm$INDEX -nodefaults -nographic -msg timestamp=on \
      -chardev pty,id=charserial0 -device isa-serial,chardev=charserial0,id=serial0 -serial stdio \
      -enable-kvm -machine accel=kvm,usb=off \
      -cpu host -smp 8,sockets=1,cores=8,threads=1 -m 8192 \
      -drive if=virtio,file=vm$INDEX.qcow2 \
      -device virtio-net-pci,netdev=net0,mac=$VM_MAC$IHEX -netdev tap,id=net0,vhost=on,fd=3 3<>/dev/macvtap0
  "
sleep 2
$DOCKERH run $PIPEWORK_INVOKE pipework mac:$HOSTMAC -i vmctrl vm$INDEX 255.255.255.$INDEX/32
