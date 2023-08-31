#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"/..
D=$1

build_image() {
  docker build --pull -t 5gdeploy.localhost/$1 docker/$1
}

build_phoenix() {
  if ! [[ -f ../phoenix-repo/phoenix-src/deploy/docker/Dockerfile ]]; then
    echo Open5GCore phoenix-src checkout is missing at $(pwd)/phoenix-repo/phoenix-src
    exit 1
  fi

  pushd ../phoenix-repo/phoenix-src
  sed 's/cmake -G Ninja/\0 -DWITH_4G=OFF -DWITH_5G=ON/' deploy/docker/Dockerfile \
  | docker build --pull -t 5gdeploy.localhost/phoenix-base \
    --build-arg UBUNTU_VERSION=22.04 \
    --build-arg CACHE_PREFIX= \
    -f - .
  popd

  docker build -t 5gdeploy.localhost/phoenix docker/phoenix
}

build_oai() {
  local TAG=2023.w18
  docker build --pull -t 5gdeploy.localhost/oai-gnb \
    --build-arg BASE=oaisoftwarealliance/oai-gnb:$TAG \
    docker/oai
  docker build --pull -t 5gdeploy.localhost/oai-nr-ue \
    --build-arg BASE=oaisoftwarealliance/oai-nr-ue:$TAG \
    docker/oai
}

case $D in
  phoenix)
    build_phoenix
    ;;
  oai)
    build_oai
    ;;
  *)
    build_image $D
    ;;
esac
