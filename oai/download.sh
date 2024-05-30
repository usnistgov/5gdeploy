#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-master}

curl -sfLS "https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed/-/archive/${TAG}/oai-cn5g-fed-${TAG}.tar.gz?path=docker-compose" |
  tar -xzv --strip-components=1
