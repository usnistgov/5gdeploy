WORK=../../virt
mkdir -p $WORK
WORK=$(readlink -f $WORK)
cd $WORK

VM_MAC=52:de:ff:ff:ff:
VM_IP=172.25.255.

RCLONE_INVOKE="
  --mount type=bind,source=$WORK,target=/data
  --mount type=bind,source=$HOME/.ssh/id_ed25519,target=/sshkey,readonly=true
  --network host
  --rm
  rclone/rclone
"

GUESTFS_INVOKE="
  --device /dev/kvm
  --mount type=bind,source=/boot,target=/hostboot,readonly=true
  --mount type=bind,source=/lib/modules,target=/lib/modules,readonly=true
  --mount type=bind,source=$WORK,target=/work
  --rm
  --workdir /work
  -e LIBGUESTFS_DEBUG=1
  -e SUPERMIN_KERNEL=/guestfs.vmlinuz
  -e XDG_CACHE_HOME=/work/guestfs-cache
  5gdeploy.localhost/virt
"

GUESTFS_KERN="
  if ! [[ -f /guestfs.vmlinuz ]]; then
    cat /hostboot/vmlinuz >/guestfs.vmlinuz
  fi
"

BRIDGE_INVOKE="
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock
  --network host
  --pid host
  --privileged
  --rm
  5gdeploy.localhost/bridge
"

QEMU_INVOKE="
  --mount type=bind,source=$WORK,target=/work
  --network none
  --privileged
  --workdir /work
  5gdeploy.localhost/virt
"
