FROM 5gdeploy.localhost/phoenix-base:latest
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends ethtool iproute2 iptables iputils-ping jq mariadb-client-core-10.6 mtr-tiny \
 && rm -rf /var/lib/apt/lists/*
 ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
 ADD --chmod=755 entrypoint.sh /
RUN touch /executor-version.txt  # ue-tunnel-mgmt.sh
