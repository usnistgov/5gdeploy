#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-master}

if [[ -d free5gc-compose ]]; then
  git -C free5gc-compose fetch
  git -C free5gc-compose checkout "${TAG}"
  git -C free5gc-compose pull || true
else
  git clone --branch "${TAG}" https://github.com/free5gc/free5gc-compose.git
fi

curl -o webconsole.yaml -fsLS https://github.com/free5gc/webconsole/raw/f4932d569dd0045fc31baca062a05d7b34e3e8e0/frontend/webconsole.yaml
docker run --rm --network none -v ./webconsole-openapi:/output -v ./webconsole.yaml:/webconsole.yaml:ro \
  openapitools/openapi-generator-cli generate -i /webconsole.yaml -g typescript-fetch -o /output
docker run --rm -v ./webconsole-openapi:/output alpine:3.21 chown -R $(id -u):$(id -g) /output
find webconsole-openapi -name '*.ts' | xargs sed -i '1 i\// @ts-nocheck'
