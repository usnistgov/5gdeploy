#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-master}

if [[ -d free5gc-compose ]]; then
  git -C free5gc-compose fetch
  git -C free5gc-compose checkout "${TAG}"
else
  git clone --branch "${TAG}" https://github.com/free5gc/free5gc-compose.git
fi

docker run -i --rm mikefarah/yq '.services | to_entries | .[].value.image' - <free5gc-compose/docker-compose.yaml >images.txt

if [[ -n $https_proxy ]]; then
  export _JAVA_OPTIONS="$(node -e '
    const u = new URL(process.env.https_proxy);
    process.stdout.write(`-Dhttps.proxyHost=${u.hostname} -Dhttps.proxyPort=${u.port}`);
  ')"
fi
docker run --rm -v ./webconsole-openapi:/output -e _JAVA_OPTIONS openapitools/openapi-generator-cli generate \
  -i https://github.com/free5gc/webconsole/raw/641d0abd09fd21906d8b08fdf400fd1262c49a22/frontend/webconsole.yaml \
  -g typescript-fetch -o /output
docker run --rm -v ./webconsole-openapi:/output alpine chown -R $(id -u):$(id -g) /output
find webconsole-openapi -name '*.ts' | xargs sed -i '1 i\// @ts-nocheck'
