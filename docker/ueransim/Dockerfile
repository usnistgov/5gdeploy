FROM free5gc/ueransim
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends ethtool iptables
  rm -rf /var/lib/apt/lists/*
EOF

ADD --chmod=755 https://github.com/mikefarah/yq/releases/download/v4.45.1/yq_linux_amd64 /usr/local/bin/yq
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/2fc85e3e422b9a981d330bf6ff945136bfae97f3/config/custom-gnb.yaml /ueransim/config/
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/2fc85e3e422b9a981d330bf6ff945136bfae97f3/config/custom-ue.yaml /ueransim/config/
