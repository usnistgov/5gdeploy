FROM golang:1.23-alpine3.20 AS build
SHELL ["/bin/ash", "-c"]
ADD https://github.com/HewlettPackard/PacketRusher/archive/fd83fec05d964cab7a16fe0d55ff230dd6d9a77a.zip /PacketRusher.zip

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
