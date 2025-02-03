#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
FED_TAG=${1:-master}
NWDAF_TAG=${2:-master}

mkdir -p fed
curl -sfLS "https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed/-/archive/${FED_TAG}/oai-cn5g-fed-${FED_TAG}.tar.gz?path=docker-compose" |
  tar -C fed -xzv --strip-components=2

mkdir -p nwdaf
curl -sfLS "https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-nwdaf/-/archive/${NWDAF_TAG}/oai-cn5g-nwdaf-${NWDAF_TAG}.tar.gz?path=docker-compose" |
  tar -C nwdaf -xzv --strip-components=2
