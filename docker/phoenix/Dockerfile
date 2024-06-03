FROM 5gdeploy.localhost/phoenix-base
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends ethtool iproute2 iptables iputils-ping jq mariadb-client-core-10.6 mtr-tiny
  rm -rf /var/lib/apt/lists/*

  touch /executor-version.txt  # used by ue-tunnel-mgmt.sh
EOF

ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
COPY --chmod=755 entrypoint.sh /
