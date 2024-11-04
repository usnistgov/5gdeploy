FROM 5gdeploy.localhost/gtp5g AS gtp5g
FROM crazymax/yasu AS yasu

FROM debian:bookworm
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends gnupg guestfs-tools jq python3-minimal qemu-system-x86
  rm -rf /var/lib/apt/lists/*
  find /etc/virt-builder/repos.d -type f ! -name 'libguestfs.*' -delete
  sed -i '/archive\.libguestfs\.org/Q' /etc/virt-builder/repos.d/libguestfs.conf
EOF

COPY --from=yasu /usr/local/bin/yasu /usr/local/bin/yasu
ADD --chmod=755 https://github.com/0xef53/qmp-shell/releases/download/v2.0.1/qmp-shell /usr/local/bin/
ADD --chmod=755 https://git.dpdk.org/dpdk/plain/usertools/dpdk-devbind.py?h=v23.11 /usr/local/bin/dpdk-devbind.py
COPY --from=gtp5g --chmod=644 /gtp5g.zip /
COPY --from=gtp5g --chmod=755 /gtp5g-load.sh /
