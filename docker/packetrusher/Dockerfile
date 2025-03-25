FROM golang:1.24-alpine3.21 AS build
SHELL ["/bin/ash", "-c"]
ADD https://github.com/HewlettPackard/PacketRusher/archive/542ddc649b5d3fcac85e8f2ee58d45d5fe07fa17.zip /PacketRusher.zip

RUN --mount=type=cache,id=go1.24-build,target=/root/.cache/go-build,sharing=locked \
<<EOF
  set -euxo pipefail
  cd /
  unzip -n PacketRusher.zip
  mv PacketRusher-* PacketRusher
  cd /PacketRusher
  env CGO_ENABLED=0 go build cmd/packetrusher.go
EOF


FROM alpine:3.21
RUN apk add --no-cache ethtool iproute2 iptables yq
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config/config.yml /
ENTRYPOINT ["/packetrusher"]
