FROM localhost/phoenix:latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends httpie iperf3 iproute2 iptables iputils-ping jq mariadb-client-core-10.6 mtr-tiny tcpdump traceroute \
 && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 entrypoint.sh /
