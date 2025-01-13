FROM debian:trixie-slim
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends iperf
  rm -rf /var/lib/apt/lists/*
EOF

ENTRYPOINT ["/usr/bin/iperf"]
