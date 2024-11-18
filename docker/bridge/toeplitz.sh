#!/bin/ash
set -euo pipefail
NETIF=$1

ETHTOOL=ethtool
if [[ $NETIF == *:* ]]; then
  CT=${NETIF%:*}
  NETIF=${NETIF#*:}
  ETHTOOL="ip netns exec $(basename $(docker inspect $CT --format='{{.NetworkSettings.SandboxKey}}')) ethtool"
fi

if [[ $2 == reset ]]; then
  HKEY40=27:fa:90:cf:ac:5f:f0:6a:e8:47:d8:53:b7:2a:bf:cc:97:d5:98:be:08:67:9f:1d:d6:04:ca:65:be:9e:41:93:60:9e:b7:87:df:33:51:31
  HKEY52=$HKEY40:fb:4c:1b:42:17:0e:b4:a7:98:2f:a5:4a
  $ETHTOOL -X $NETIF hkey $HKEY40 || $ETHTOOL -X $NETIF hkey $HKEY52
  $ETHTOOL -X $NETIF default hfunc toeplitz
  $ETHTOOL -x $NETIF
  exit
fi

START=$2
EQUAL=$3
INPUT=$4

if [[ $INPUT == s ]]; then
  HKEY40=00:00:00:00:00:00:00:$(printf %02x $EQUAL):00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
elif [[ $INPUT == d ]]; then
  HKEY40=00:00:00:00:00:00:00:00:00:00:00:$(printf %02x $EQUAL):00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
fi
HKEY52=$HKEY40:00:00:00:00:00:00:00:00:00:00:00:00

$ETHTOOL -K $NETIF lro off ntuple on rxhash on
$ETHTOOL -X $NETIF hkey $HKEY40 || $ETHTOOL -X $NETIF hkey $HKEY52
$ETHTOOL -X $NETIF start $START equal $EQUAL hfunc toeplitz
$ETHTOOL -x $NETIF
