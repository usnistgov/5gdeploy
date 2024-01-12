#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-develop}

curl -sfLS "https://gitlab.eurecom.fr/oai/openairinterface5g/-/archive/${TAG}/openairinterface5g-${TAG}.tar.gz?path=ci-scripts/conf_files" |
  tar -xzv --strip-components=2

curl -sfLS "https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed/-/archive/${TAG}/oai-cn5g-fed-${TAG}.tar.gz?path=docker-compose" |
  tar -xzv --strip-components=1

echo $TAG >conf_files/TAG
