#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"/..
D=$1
shift

TAG=${1:-}
TAG_ARG=()
if [[ -n "${TAG:-}" ]]; then
  shift
  TAG_ARG=(--build-arg TAG="$TAG")
fi

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
  docker build $PULL1 --progress=plain -t 5gdeploy.localhost/$NAME "$@" docker/$NAME "${TAG_ARG[@]}"
}

build_oai_nwdaf_microservice() {
  local MS=$1
  local TAG=$2
  shift 2
  docker build $PULL --progress=plain -t 5gdeploy.localhost/oai-nwdaf-$MS \
    "$@" -f docker/Dockerfile.$MS \
    https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-nwdaf.git#$TAG:components/oai-nwdaf-$MS
}

build_oai_nwdaf() {
  if [[ -n "${TAG:-}" ]]; then
    TAG=http2_server_support
    TAG_ARG=(--build-arg TAG="$TAG")
  fi

  for MS in engine nbi-analytics nbi-events nbi-ml sbi; do
    build_oai_nwdaf_microservice $MS "$TAG" \
      --build-arg BUILD_IMAGE=golang:1.23-alpine3.21 \
      --build-arg TARGET_IMAGE=alpine:3.21 \
      "${TAG_ARG[@]}"
  done

  build_oai_nwdaf_microservice engine-ads "$TAG"

  docker build $PULL --progress=plain -t 5gdeploy.localhost/oai-nwdaf-cli \
    "${TAG_ARG[@]}" \
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

ubuntu_codename() {
  UBUNTU_CODENAME=$(grep -oP '^UBUNTU_CODENAME=\K.*' /etc/os-release 2>/dev/null)
  if [[ -z "$UBUNTU_CODENAME" ]]; then
    UBUNTU_CODENAME=$(grep -oP '^VERSION_CODENAME=\K.*' /etc/os-release 2>/dev/null)
  fi
  if [[ -z "$UBUNTU_CODENAME" ]]; then
    echo "Unable to determine Ubuntu codename from /etc/os-release" >&2
    exit 1
  fi
  echo "$UBUNTU_CODENAME"
}

case $D in
  gtp5g)
    build_image gtp5g --build-arg BUILDPACK_TAG="$(ubuntu_codename)"
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
