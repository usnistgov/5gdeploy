FROM 5gdeploy.localhost/phoenix-base:latest
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iperf3 iproute2 iptables iputils-ping jq mariadb-client-core-10.6 mtr-tiny netcat-openbsd traceroute \
 && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/master/pipework /usr/local/bin/
ADD --chmod=755 entrypoint.sh /
