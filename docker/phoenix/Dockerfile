FROM localhost/phoenix-base
SHELL ["/bin/bash", "-c"]

RUN --mount=type=cache,id=jammy-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=jammy-apt-cache,target=/var/lib/apt,sharing=locked \
<<EOF
  set -euxo pipefail
  rm -f /etc/apt/apt.conf.d/docker-clean
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache
  apt-get update
  apt-get install -y --no-install-recommends ethtool iproute2 iptables iputils-ping jq mariadb-client-core-10.6 mtr-tiny
EOF

COPY --chmod=755 taskset.sh /
