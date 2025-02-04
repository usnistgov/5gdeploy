FROM localhost/phoenix-base
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends ethtool iproute2 iptables iputils-ping jq mariadb-client-core-10.6 mtr-tiny
  rm -rf /var/lib/apt/lists/*

  touch /executor-version.txt  # used by ue-tunnel-mgmt.sh
EOF

COPY --chmod=755 taskset.sh /
