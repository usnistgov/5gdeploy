#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"/..
D=$1

PULL=--pull
if [[ ${NOPULL:-} -eq 1 ]]; then
  PULL=''
fi

build_image() {
  docker build $PULL -t 5gdeploy.localhost/$1 docker/$1
}

build_phoenix() {
  if ! [[ -f ../phoenix-repo/phoenix-src/deploy/docker/Dockerfile ]]; then
    cd ..
    echo Open5GCore phoenix-src checkout is missing at $(pwd)/phoenix-repo/phoenix-src >/dev/stderr
    exit 1
  fi

  pushd ../phoenix-repo/phoenix-src
  sed 's/cmake -G Ninja/\0 -DWITH_4G=OFF -DWITH_5G=ON/' deploy/docker/Dockerfile |
    docker build $PULL -t 5gdeploy.localhost/phoenix-base \
      --build-arg UBUNTU_VERSION=22.04 \
      --build-arg CACHE_PREFIX= \
      -f - .
  popd

  docker build -t 5gdeploy.localhost/phoenix docker/phoenix
}

build_free5gc_upf() {
  if ! [[ -f free5gc/images.txt ]]; then
    bash free5gc/download.sh
  fi
  docker build $PULL -t 5gdeploy.localhost/free5gc-upf \
    --build-arg BASE=$(grep '^free5gc/upf:' free5gc/images.txt) \
    docker/free5gc-upf
}

case $D in
  phoenix)
    build_phoenix
    ;;
  free5gc-upf)
    build_free5gc_upf
    ;;
  *)
    build_image $D
    ;;
esac
