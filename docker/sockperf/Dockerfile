FROM ryozitn/sockperf:3.10 AS sockperf

FROM debian:bookworm-slim
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends gawk iproute2 jq
  rm -rf /var/lib/apt/lists/*
EOF

COPY --from=sockperf /usr/bin/sockperf /usr/local/bin/
ADD --chmod=755 https://github.com/Mellanox/sockperf/raw/91b10ca095ea2efe6aaab830e34c2afe2c3e4cbf/tools/gen2.awk /usr/local/bin/
