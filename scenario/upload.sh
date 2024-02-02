#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
D=$1
shift

msg() {
  echo -ne "\e[35m[5gdeploy-scenario] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

upload_sshkey() {
  if ! [[ -f ~/.ssh/id_ed25519 ]]; then
    msg Generating SSH key pair with ed25519 algorithm
    ssh-keygen -f ~/.ssh/id_ed25519 -N '' -t ed25519
  fi
  while [[ -n ${1:-} ]]; do
    local H=$1
    shift
    msg Uploading SSH public key to $H, you may be prompted for host key confirmation and interactive password
    ssh-copy-id -i ~/.ssh/id_ed25519 $H
  done
}

upload_docker() {
  local IMAGES=$(docker images --format='{{.Repository}}' | grep 5gdeploy.localhost)
  msg Docker images to be uploaded: $IMAGES
  while [[ -n ${1:-} ]]; do
    local H=$1
    shift
    msg Uploading Docker images to $H
    docker save $IMAGES | docker -H ssh://$H load
  done
}

upload_folder() {
  while [[ -n ${1:-} ]]; do
    local H=$1
    shift
    msg Uploading $D to $H
    docker run -it --rm --network host \
      -v ~/.ssh/id_ed25519:/sshkey:ro -v $D:/source:ro rclone/rclone \
      sync /source :sftp:$D -P --transfers=2 --sftp-host=$H --sftp-user=$USER --sftp-key-file=/sshkey
  done
}

case $D in
  sshkey)
    upload_sshkey "$@"
    exit 0
    ;;
  docker)
    upload_docker "$@"
    exit 0
    ;;
  *)
    upload_folder "$@"
    exit 0
    ;;
esac
