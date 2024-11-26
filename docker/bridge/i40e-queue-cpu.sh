#!/bin/ash
set -euo pipefail
PCI=$1
CPU=$2

if [[ -d /sys/class/net/$PCI ]]; then
  PCI=$(basename $(readlink -f /sys/class/net/$PCI/device))
fi

awk -vPCI=$PCI '
  $NF == "i40e-" PCI ":misc" {
    inside = 1
    next
  }
  $NF !~ /i40e-[0-9a-z]+-TxRx-[0-9]+/ {
    inside = 0
  }
  inside {
    sub(":", "", $1)
    split($NF, a, "-")
    print $1 "=" a[4]
  }
' /proc/interrupts | while read LINE; do
  IRQ=${LINE%=*}
  QUEUE=${LINE#*=}
  if grep -q -w $CPU /proc/irq/$IRQ/effective_affinity_list; then
    echo $QUEUE
  fi
done
