FROM golang:1.21-alpine3.19 AS build
ADD https://github.com/HewlettPackard/PacketRusher/archive/10da3f72fc2c7abd799d1359b7a76bf2b2542b28.zip /PacketRusher.zip
RUN cd / \
 && unzip -n PacketRusher.zip \
 && mv PacketRusher-* PacketRusher \
 && cd /PacketRusher \
 && env CGO_ENABLED=0 go build cmd/packetrusher.go \
 && cp config/config.yml config.default.yml

FROM alpine:3.19
RUN apk add --no-cache iproute2 yq
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.default.yml /
