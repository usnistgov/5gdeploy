FROM golang:1.21-alpine3.19 AS build
ADD https://github.com/HewlettPackard/PacketRusher/archive/0f16f15f862f90ae463f94c79f1c68bd946e463a.zip /PacketRusher.zip
RUN cd / \
 && unzip -n PacketRusher.zip \
 && mv PacketRusher-* PacketRusher \
 && cd /PacketRusher \
 && env CGO_ENABLED=0 go build cmd/packetrusher.go \
 && cp config/config.yml config.default.yml

FROM alpine:3.19
RUN apk add --no-cache iproute2 yq
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.default.yml /
