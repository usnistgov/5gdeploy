#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source _common.sh

if ! [[ -f id_ed25519.pub ]]; then
  install -m0644 $HOME/.ssh/id_ed25519.pub id_ed25519.pub
fi

if ! [[ -f daemon.json ]]; then
  jq -n -S '{
    "bridge": "none",
    "log-driver": "local",
    "log-opts": {
      "max-size": "10m",
      "max-file": "3"
    },
  }' >daemon.json
fi

if ! [[ -f base.done ]]; then
  docker run $GUESTFS_INVOKE bash -c "
    set -euo pipefail
    $GUESTFS_KERN

    yasu $(id -u):\$(stat -c %g /dev/kvm) \
    virt-builder debian-12 \
    --size 20G --format qcow2 -o base.qcow2 \
    --run-command 'apt-mark hold grub-pc' \
    --uninstall ifupdown \
    --update \
    --install curl,htop,linux-headers-amd64,make,netplan.io,wireshark-common \
    --run-command 'apt-mark unhold grub-pc' \
    --delete '/etc/ssh/ssh_host_*' \
    --firstboot-command 'dpkg-reconfigure openssh-server' \
    --run-command 'curl -fsLS https://get.docker.com | bash' \
    --copy-in daemon.json:/etc/docker/ \
    --copy-in /gtp5g:/ \
    --firstboot /gtp5g-load.sh
  "
  touch base.done
fi

if [[ -z ${1:-} ]]; then
  exit
fi
INDEX=$1
IHEX=$(printf %02x $INDEX)
VMHOST=${2:-}

if [[ -f vm$INDEX.done ]]; then
  exit
fi

jq -n -S \
  --arg MAC $VM_MAC$IHEX \
  --arg IP $VM_IP$INDEX/24 '
{
  network: {
    ethernets: {
      vmctrl: {
        "set-name": "vmctrl",
        match: {
          macaddress: $MAC
        },
        addresses: [
          $IP
        ]
      }
    }
  }
}' | yq -pj -oy >01-netcfg$INDEX.yaml

if [[ -n $VMHOST ]]; then
  if ! [[ -f tarball.done ]]; then
    tar -cSf tarball.tar base.qcow2 id_ed25519.pub
    touch tarball.done
  fi
  for FILE in tarball.tar 01-netcfg$INDEX.yaml; do
    docker run $RCLONE_INVOKE copyto $FILE :sftp:$WORK/$FILE \
      --sftp-host=$VMHOST --sftp-user=$(id -un) --sftp-key-file=/sshkey
  done
  rm 01-netcfg$INDEX.yaml
fi

DOCKERH=docker
if [[ -n $VMHOST ]]; then
  DOCKERH="docker -H ssh://$VMHOST"
fi
$DOCKERH run $GUESTFS_INVOKE bash -c "
  set -euo pipefail
  $GUESTFS_KERN

  if [[ -f base.qcow2 ]]; then
    yasu \$(stat -c %u:%g base.qcow2) bash -c \"
      cp base.qcow2 vm$INDEX.qcow2
    \"
  else
    yasu \$(stat -c %u:%g tarball.tar) bash -c \"
      tar -xSf tarball.tar
      mv base.qcow2 vm$INDEX.qcow2
    \"
  fi

  yasu \$(stat -c %u vm$INDEX.qcow2):\$(stat -c %g /dev/kvm) \
  virt-sysprep -a vm$INDEX.qcow2 \
    --hostname vm$INDEX.5gdeploy \
    --copy-in 01-netcfg$INDEX.yaml:/etc/netplan/ \
    --root-password password:0000 \
    --ssh-inject root:file:id_ed25519.pub

  rm 01-netcfg$INDEX.yaml
"
touch vm$INDEX.done
