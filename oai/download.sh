#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-master}
NWDAF_TAG=${2:-master}

curl -sfLS "https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed/-/archive/${TAG}/oai-cn5g-fed-${TAG}.tar.gz?path=docker-compose" |
  tar -xzv --strip-components=1

mkdir -p docker-compose/nwdaf
curl -sfLS "https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-nwdaf/-/archive/${TAG}/oai-cn5g-nwdaf-${TAG}.tar.gz?path=docker-compose" |
  tar -C docker-compose/nwdaf -xzv --strip-components=2
