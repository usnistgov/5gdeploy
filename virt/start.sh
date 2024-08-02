#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source _common.sh

INDEX=$1
VMHOST=$2
HOSTMAC=$3
VMIF=vm${INDEX}n0
IHEX=$(printf %02x $INDEX)

DOCKERH=docker
if [[ -n $VMHOST ]]; then
  DOCKERH="docker -H ssh://$VMHOST"
fi
$DOCKERH rm -f vm$INDEX
$DOCKERH run $BRIDGE_INVOKE sh -c "
  set -euo pipefail
  ip link del $VMIF || true

  HOSTIF=\$(ip -j link | jq -r '.[] | select(.address==\"$HOSTMAC\") | .ifname')
  ip link add link \$HOSTIF name $VMIF type macvtap mode bridge
  ip link set $VMIF up address $VM_MAC$IHEX
  echo MACVTAP \$(basename /sys/devices/virtual/net/$VMIF/tap*)
" | tee vm$INDEX.setup
TAPDEV=$(awk '$1=="MACVTAP" { print $2 }' vm$INDEX.setup)
$DOCKERH run -dit --name vm$INDEX --device /dev/$TAPDEV \
  $QEMU_INVOKE bash -c "
    set -euo pipefail

    yasu \$(stat -c %u vm$INDEX.qcow2):\$(stat -c %g /dev/kvm) qemu-system-x86_64 \
      -name vm$INDEX -nodefaults -nographic -msg timestamp=on \
      -chardev pty,id=charserial0 -device isa-serial,chardev=charserial0,id=serial0 -serial stdio \
      -enable-kvm -machine accel=kvm,usb=off \
      -cpu host -smp 8,sockets=1,cores=8,threads=1 -m 8192 \
      -drive if=virtio,file=vm$INDEX.qcow2 \
      -device virtio-net-pci,netdev=net0,mac=$VM_MAC$IHEX -netdev tap,id=net0,vhost=on,fd=3 3<>/dev/$TAPDEV
  "
