#!/bin/ash
set -euo pipefail
NETIF=$1

CTNS=env
if [[ $NETIF == *:* ]]; then
  CT=${NETIF%:*}
  NETIF=${NETIF#*:}
  CTNS="$(ctns.sh $CT)"
fi

if [[ $2 == reset ]]; then
  HKEY40=27:fa:90:cf:ac:5f:f0:6a:e8:47:d8:53:b7:2a:bf:cc:97:d5:98:be:08:67:9f:1d:d6:04:ca:65:be:9e:41:93:60:9e:b7:87:df:33:51:31
  HKEY52=$HKEY40:fb:4c:1b:42:17:0e:b4:a7:98:2f:a5:4a
  $CTNS ethtool -X $NETIF hkey $HKEY40 || $CTNS ethtool -X $NETIF hkey $HKEY52
  $CTNS ethtool -X $NETIF default hfunc toeplitz
  $CTNS ethtool -x $NETIF
  exit
fi

START=$2
EQUAL=$3
INPUT=$4

if [[ $START == i40e:* ]]; then
  START=$($CTNS i40e-queue-cpu.sh $NETIF ${START#i40e:})
  if [[ -z $START ]] || [[ $(echo $START | wc -l) -ne 1 ]]; then
    echo 'Unable to determine i40e queue number.'
    exit 1
  fi
fi

HKEY40=$(echo | awk -vINPUT=$INPUT -vEQUAL=$EQUAL -vOFS=: '
  {
    for (i = 1; i <= 40; ++i) {
      $i = "00"
    }
    N = sprintf("%02x", EQUAL)
  }
  INPUT == "s" { $8  = N }
  INPUT == "d" { $12 = N }
  INPUT == "f" { $14 = N }
  INPUT == "n" { $16 = N }
  {
    print
  }
')
HKEY52=$HKEY40:00:00:00:00:00:00:00:00:00:00:00:00

$CTNS ethtool -K $NETIF lro off ntuple on rxhash on
$CTNS ethtool -X $NETIF hkey $HKEY40 || $CTNS ethtool -X $NETIF hkey $HKEY52
$CTNS ethtool -X $NETIF start $START equal $EQUAL hfunc toeplitz
$CTNS ethtool -x $NETIF
