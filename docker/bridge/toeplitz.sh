#!/bin/ash
set -euo pipefail
NETIF=$1
START=$2
EQUAL=$3
INPUT=$4

if [[ $INPUT == 's' ]]; then
  HKEY40=00:00:00:00:00:00:00:$(printf %02x $EQUAL):00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
elif [[ $INPUT == 'd' ]]; then
  HKEY40=00:00:00:00:00:00:00:00:00:00:00:$(printf %02x $EQUAL):00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
fi
HKEY52=$HKEY40:00:00:00:00:00:00:00:00:00:00:00:00

ethtool -K $NETIF lro off ntuple on rxhash on
ethtool -X $NETIF hkey $HKEY40 start $START equal $EQUAL hfunc toeplitz ||
  ethtool -X $NETIF hkey $HKEY52 start $START equal $EQUAL hfunc toeplitz
ethtool -x $NETIF
