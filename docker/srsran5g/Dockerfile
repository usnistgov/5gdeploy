ARG TAG=24_10_1
FROM gradiant/srsran-5g:${TAG}
SHELL ["/bin/bash", "-c"]

RUN --mount=type=cache,id=jammy-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=jammy-apt-cache,target=/var/lib/apt,sharing=locked \
<<EOF
  set -euxo pipefail
  rm -f /etc/apt/apt.conf.d/docker-clean
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache
  apt-get update
  apt-get install -y --no-install-recommends ethtool
EOF

ADD --chmod=755 https://github.com/mikefarah/yq/releases/download/v4.45.1/yq_linux_amd64 /usr/local/bin/yq
