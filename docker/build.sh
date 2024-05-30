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

add_pipework() {
  local BASE=$1
  docker build $PULL -t 5gdeploy.localhost/$D --build-arg BASE=$BASE docker/add-pipework
}

add_pipework_compose() {
  local DOWNLOAD=$1
  local COMPOSEFILE=$2

  if ! [[ -f $COMPOSEFILE ]]; then
    bash $DOWNLOAD
  fi
  add_pipework $(CT=$3 yq '.services[strenv(CT)].image' $COMPOSEFILE)
}

case $D in
  free5gc-upf)
    add_pipework_compose free5gc/download.sh free5gc/free5gc-compose/docker-compose.yaml free5gc-upf
    ;;
  oai-gnb)
    add_pipework_compose oai/download.sh oai/docker-compose/docker-compose-slicing-ransim.yaml oai-gnb
    ;;
  oai-upf)
    add_pipework_compose oai/download.sh oai/docker-compose/docker-compose-basic-nrf.yaml oai-upf
    ;;
  phoenix)
    build_phoenix
    ;;
  srsgnb)
    add_pipework gradiant/srsran-5g:24_04
    ;;
  *)
    build_image $D
    ;;
esac
