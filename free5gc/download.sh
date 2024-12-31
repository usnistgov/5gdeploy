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

if [[ -n ${https_proxy:-} ]]; then
  export _JAVA_OPTIONS="$(node -e '
    const u = new URL(process.env.https_proxy);
    process.stdout.write(`-Dhttps.proxyHost=${u.hostname} -Dhttps.proxyPort=${u.port}`);
  ')"
fi
docker run --rm -v ./webconsole-openapi:/output -e _JAVA_OPTIONS openapitools/openapi-generator-cli generate \
  -i https://github.com/free5gc/webconsole/raw/06185fd39e8176e86e73e5b7c2a4f6d0bbe07a92/frontend/webconsole.yaml \
  -g typescript-fetch -o /output
docker run --rm -v ./webconsole-openapi:/output alpine:3.21 chown -R $(id -u):$(id -g) /output
find webconsole-openapi -name '*.ts' | xargs sed -i '1 i\// @ts-nocheck'
