FROM alpine:3.21
SHELL ["/bin/ash", "-c"]
ARG TAG=9ba97f1735022fb5f811d9c2a304dda33fae1ad1

# ethtool 6.11 is failing in '-X hkey' command on Linux kernel 6.1
RUN <<EOF
  set -euxo pipefail
  echo 'https://dl-cdn.alpinelinux.org/alpine/v3.20/main' | tee -a /etc/apk/repositories
  apk add --no-cache arping docker-cli 'ethtool<6.11' iproute2 jq util-linux-misc
EOF

ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/${TAG}/pipework /usr/local/bin/
COPY --chmod=755 *.sh /usr/local/bin/
