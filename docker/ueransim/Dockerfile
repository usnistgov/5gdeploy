FROM free5gc/ueransim
SHELL ["/bin/bash", "-c"]

RUN --mount=type=cache,id=bullseye-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=bullseye-apt-cache,target=/var/lib/apt,sharing=locked \
<<EOF
  set -euxo pipefail
  rm -f /etc/apt/apt.conf.d/docker-clean
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache
  apt-get update
  apt-get install -y --no-install-recommends ethtool iptables
EOF

ADD --chmod=755 https://github.com/mikefarah/yq/releases/download/v4.45.1/yq_linux_amd64 /usr/local/bin/yq
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/2fc85e3e422b9a981d330bf6ff945136bfae97f3/config/custom-gnb.yaml /ueransim/config/
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/2fc85e3e422b9a981d330bf6ff945136bfae97f3/config/custom-ue.yaml /ueransim/config/
