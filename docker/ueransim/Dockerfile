FROM herlesupreeth/ueransim
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iperf3 iproute2 iptables iputils-ping jq mtr-tiny netcat-openbsd traceroute \
 && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/TomWright/dasel/releases/download/v2.3.4/dasel_linux_amd64 /usr/local/bin/dasel
ENTRYPOINT []
ADD --chmod=755 entrypoint.sh /
