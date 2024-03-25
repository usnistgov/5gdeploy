FROM golang:1.22-alpine3.19 AS build
ADD https://github.com/HewlettPackard/PacketRusher/archive/1d88b76c945738b9f0a547c22531d87fcfb7b6cd.zip /PacketRusher.zip
RUN cd / \
 && unzip -n PacketRusher.zip \
 && mv PacketRusher-* PacketRusher \
 && cd /PacketRusher \
 && env CGO_ENABLED=0 go build cmd/packetrusher.go \
 && cp config/config.yml config.base.yml

FROM alpine:3.19
RUN apk add --no-cache iproute2 yq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/8a24c61bd731a78f571a9cec80bd2447a5c1cf62/pipework /usr/local/bin/
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.base.yml /
