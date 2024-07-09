FROM golang:1.22-alpine3.20 AS build
SHELL ["/bin/ash", "-c"]
ADD https://github.com/HewlettPackard/PacketRusher/archive/32a08fa9fb2d83b654628b5187a0244a66b737b2.zip /PacketRusher.zip

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
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.base.yml /
