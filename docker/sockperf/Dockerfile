FROM debian:bookworm
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends iproute2 jq sockperf
  rm -rf /var/lib/apt/lists/*
EOF
