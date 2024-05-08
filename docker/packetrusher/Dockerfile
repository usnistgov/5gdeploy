FROM golang:1.22-alpine3.19 AS build
ADD https://github.com/HewlettPackard/PacketRusher/archive/578563bb2f32925a5178c8f5c17d5ba723c7dd48.zip /PacketRusher.zip
RUN cd / \
 && unzip -n PacketRusher.zip \
 && mv PacketRusher-* PacketRusher \
 && cd /PacketRusher \
 && env CGO_ENABLED=0 go build cmd/packetrusher.go \
 && cp config/config.yml config.base.yml

FROM alpine:3.19
RUN apk add --no-cache iproute2 iptables yq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.base.yml /
