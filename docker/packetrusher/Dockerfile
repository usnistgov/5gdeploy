FROM golang:1.21-alpine3.18 AS build
ADD https://github.com/HewlettPackard/PacketRusher/archive/f104a3131ca09b36c7cf24c748f5a94425c0218a.zip /PacketRusher.zip
RUN cd / \
 && unzip -n PacketRusher.zip \
 && mv PacketRusher-* PacketRusher \
 && cd /PacketRusher \
 && env CGO_ENABLED=0 go build cmd/packetrusher.go \
 && cp config/config.yml config.default.yml

FROM alpine:3.18
RUN apk add --no-cache iproute2 yq
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.default.yml /
