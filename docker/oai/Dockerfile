ARG BASE
FROM ${BASE}
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iperf3 iproute2 iptables iputils-ping jq mtr-tiny netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT []
ADD --chmod=755 entrypoint.sh /
