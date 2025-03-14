#!/bin/ash
set -euo pipefail

# Find the RX queue number of an i40e Physical Function, where interrupts for the queue is
# processed by a specific CPU core.

PCI=$1 # either ifname or PCI address
CPU=$2 # CPU core

if [[ -d /sys/class/net/$PCI ]]; then
  # turn ifname into PCI address
  PCI=$(basename $(readlink -f /sys/class/net/$PCI/device))
fi

# list pairs of IRQ number and queue number
awk -vPCI=$PCI '
  $NF == "i40e-" PCI ":misc" {
    inside = 1
    next
  }
  $NF !~ /i40e-[^:]+-TxRx-[0-9]+/ {
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
  # check if the specified CPU core is listed on the effective affinity list
  if grep -q -w $CPU /proc/irq/$IRQ/effective_affinity_list; then
    echo $QUEUE
  fi
done
