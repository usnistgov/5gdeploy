#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-main}

if [[ -d upf ]]; then
  git -C upf fetch
  git -C upf checkout "${TAG}"
  git -C upf pull || true
else
  git clone --branch "${TAG}" https://github.com/omec-project/upf.git
fi

make -C upf docker-build

VERSION=$(cat upf/VERSION)
docker image tag upf-epc-pfcpiface:$VERSION 5gdeploy.localhost/omec-upf-pfcpiface
docker image tag upf-epc-bess:$VERSION 5gdeploy.localhost/omec-upf-bess
