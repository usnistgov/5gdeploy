FROM gradiant/srsran-5g:24_10
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends ethtool
  rm -rf /var/lib/apt/lists/*
EOF

ADD --chmod=755 https://github.com/mikefarah/yq/releases/download/v4.44.6/yq_linux_amd64 /usr/local/bin/yq
