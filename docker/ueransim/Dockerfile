FROM free5gc/ueransim:latest
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iptables jq mtr-tiny \
 && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/mikefarah/yq/releases/download/v4.43.1/yq_linux_amd64 /usr/local/bin/yq
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/ab5cd8607f914c6ca6bbb48114a008b6bf8e21d0/config/custom-gnb.yaml /ueransim/config/
ADD --chmod=644 https://github.com/aligungr/UERANSIM/raw/ab5cd8607f914c6ca6bbb48114a008b6bf8e21d0/config/custom-ue.yaml /ueransim/config/
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
ADD --chmod=755 entrypoint.sh /
ENTRYPOINT []
