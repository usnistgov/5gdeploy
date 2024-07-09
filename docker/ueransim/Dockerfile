FROM free5gc/ueransim
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends iptables
  rm -rf /var/lib/apt/lists/*
EOF

ADD --chmod=755 https://github.com/mikefarah/yq/releases/download/v4.44.2/yq_linux_amd64 /usr/local/bin/yq
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/b68de9b52a856b1f632b6cb6d38928e16163b00a/config/custom-gnb.yaml /ueransim/config/
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/b68de9b52a856b1f632b6cb6d38928e16163b00a/config/custom-ue.yaml /ueransim/config/
