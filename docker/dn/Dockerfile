FROM alpine:3.21
SHELL ["/bin/ash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apk add --no-cache ethtool iproute2 iptables jq mtr
EOF
