FROM free5gc/ueransim:latest
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iperf3 iptables jq mtr-tiny netcat-openbsd traceroute \
 && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/TomWright/dasel/releases/download/v2.3.4/dasel_linux_amd64 /usr/local/bin/dasel
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/ab5cd8607f914c6ca6bbb48114a008b6bf8e21d0/config/custom-gnb.yaml /ueransim/config/
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/ab5cd8607f914c6ca6bbb48114a008b6bf8e21d0/config/custom-ue.yaml /ueransim/config/
ENTRYPOINT []
ADD --chmod=755 entrypoint.sh /
