#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-v0.8.2}

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

msg Trying to load gtp5g kernel module
if sudo modprobe gtp5g; then
  msg Loaded gtp5g kernel module
  exit 0
fi

msg Downloading and building gtp5g kernel module
rm -rf gtp5g
mkdir -p gtp5g
curl -fsLS https://github.com/free5gc/gtp5g/archive/${TAG}.tar.gz | tar -C gtp5g -xz --strip-components=1
make -C gtp5g
sudo make -C gtp5g install

msg gtp5g kernel module is ready
