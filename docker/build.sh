#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"/..
D=$1
shift

PULL=--pull
if [[ ${NOPULL:-} -eq 1 ]]; then
  PULL=''
fi

build_image() {
  local NAME=$1
  shift
  local PULL1=$PULL
  if grep -q localhost/ docker/$NAME/Dockerfile; then
    PULL1=''
  fi
  docker build $PULL1 --progress=plain -t 5gdeploy.localhost/$NAME "$@" docker/$NAME
}

build_oai_nwdaf_microservice() {
  local MS=$1
  shift
  docker build $PULL --progress=plain -t 5gdeploy.localhost/oai-nwdaf-$MS \
    "$@" -f docker/Dockerfile.$MS \
    https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-nwdaf.git#$BRANCH:components/oai-nwdaf-$MS
}

build_oai_nwdaf() {
  local BRANCH=http2_server_support

  for MS in engine nbi-analytics nbi-events nbi-ml sbi; do
    build_oai_nwdaf_microservice $MS \
      --build-arg BUILD_IMAGE=golang:1.23-alpine3.21 \
      --build-arg TARGET_IMAGE=alpine:3.21
  done

  build_oai_nwdaf_microservice engine-ads

  docker build $PULL --progress=plain -t 5gdeploy.localhost/oai-nwdaf-cli \
    --build-arg branch=$BRANCH \
    docker/oai-nwdaf-cli
}

build_phoenix() {
  if ! [[ -f ../phoenix-repo/phoenix-src/deploy/docker/Dockerfile ]]; then
    cd ..
    echo Open5GCore phoenix-src checkout is missing at $(pwd)/phoenix-repo/phoenix-src >/dev/stderr
    exit 1
  fi

  pushd ../phoenix-repo/phoenix-src
  sed 's/cmake -G Ninja/\0 -DWITH_4G=OFF -DWITH_5G=ON/' deploy/docker/Dockerfile |
    docker build $PULL --progress=plain -t localhost/phoenix-base \
      --build-arg UBUNTU_VERSION=22.04 \
      --build-arg CACHE_PREFIX= \
      -f - .
  popd

  build_image phoenix
}

case $D in
  gtp5g)
    build_image gtp5g --build-arg BUILDPACK_TAG="$(lsb_release -c -s)"
    ;;
  oai-nwdaf)
    build_oai_nwdaf
    ;;
  phoenix)
    build_phoenix
    ;;
  *)
    build_image $D "$@"
    ;;
esac
