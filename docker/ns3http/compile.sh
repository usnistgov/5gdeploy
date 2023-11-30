#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

g++ -std=c++17 -Wall -o ns3http main.cpp -I/usr/include/ns3.35 \
  $(find /usr/lib/x86_64-linux-gnu/ -name 'libns3.35-*.so' -printf ' %f' | sed -e 's/lib/-l/g' -e 's/\.so//g')
