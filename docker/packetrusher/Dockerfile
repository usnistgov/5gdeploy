FROM golang:1.22-alpine3.20 AS build
SHELL ["/bin/ash", "-c"]
ADD https://github.com/HewlettPackard/PacketRusher/archive/2bbcc24fa2ebf14335d6eec8737291f2205b91a1.zip /PacketRusher.zip

RUN <<EOF
  set -euxo pipefail
  cd /
  unzip -n PacketRusher.zip
  mv PacketRusher-* PacketRusher
  cd /PacketRusher
  env CGO_ENABLED=0 go build cmd/packetrusher.go
  cp config/config.yml config.base.yml
EOF


FROM alpine:3.20
RUN apk add --no-cache iproute2 iptables yq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.base.yml /
