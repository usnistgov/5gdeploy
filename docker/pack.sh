#!/bin/bash
set -euo pipefail

# This script inserts `build:` attribute to each Compose service that relies on a locally built
# Docker image. The modified Compose file can run without installing 5gdeploy.
# Usage:
#   cd ~/compose/20230501
#   ~/5gdeploy/docker/pack.sh compose.yml

INPUT="${1:-compose.yml}"
DOCKER_DIR="$(dirname "${BASH_SOURCE[0]}")"

mkdir -p ./build/
for IMAGE in $(yq -o tsv '.services[] | .image' $INPUT | awk -vFS=/ '$1=="5gdeploy.localhost" { print $2 }' | sort -u); do
  if ! [[ -d $DOCKER_DIR/$IMAGE ]]; then
    continue
  fi
  rm -rf ./build/$IMAGE/
  cp -r $DOCKER_DIR/$IMAGE/ ./build/
  yq -i "(.services[] | select(.image==\"5gdeploy.localhost/$IMAGE\")).build = \"./build/$IMAGE/\"" $INPUT
done
