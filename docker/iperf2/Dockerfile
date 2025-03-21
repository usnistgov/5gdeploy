FROM debian:trixie-slim
SHELL ["/bin/bash", "-c"]

RUN --mount=type=cache,id=trixie-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=trixie-apt-cache,target=/var/lib/apt,sharing=locked \
<<EOF
  set -euxo pipefail
  rm -f /etc/apt/apt.conf.d/docker-clean
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache
  apt-get update
  apt-get install -y --no-install-recommends iperf
EOF

ENTRYPOINT ["/usr/bin/iperf"]
