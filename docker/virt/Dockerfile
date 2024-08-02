FROM 5gdeploy.localhost/gtp5g AS gtp5g
FROM crazymax/yasu AS yasu

FROM debian:bookworm
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends gnupg guestfs-tools qemu-system-x86
  rm -rf /var/lib/apt/lists/*
  find /etc/virt-builder/repos.d -type f ! -name 'libguestfs.*' -delete
  sed -i '/archive\.libguestfs\.org/Q' /etc/virt-builder/repos.d/libguestfs.conf
EOF

COPY --from=yasu /usr/local/bin/yasu /usr/local/bin/yasu
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/

COPY --from=gtp5g /gtp5g-load.sh /
COPY --from=gtp5g --link /gtp5g /gtp5g
