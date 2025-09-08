#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
FED_TAG=${1:-}
FED_TAG=${FED_TAG:-2024.w45}
NWDAF_TAG=${2:-6a1408c9be6f5cf0ddb6c1f1b527a04e36205471}

mkdir -p fed
curl -sfLS "https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed/-/archive/${FED_TAG}/oai-cn5g-fed-${FED_TAG}.tar.gz?path=docker-compose" |
  tar -C fed -xzv --strip-components=2

mkdir -p nwdaf
curl -sfLS "https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-nwdaf/-/archive/${NWDAF_TAG}/oai-cn5g-nwdaf-${NWDAF_TAG}.tar.gz?path=docker-compose" |
  tar -C nwdaf -xzv --strip-components=2
