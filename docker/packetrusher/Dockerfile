FROM golang:1.22-alpine3.19 AS build
ADD https://github.com/HewlettPackard/PacketRusher/archive/6e163a5385fd9534338909bc4c7cc20b97543bbd.zip /PacketRusher.zip
RUN cd / \
 && unzip -n PacketRusher.zip \
 && mv PacketRusher-* PacketRusher \
 && cd /PacketRusher \
 && env CGO_ENABLED=0 go build cmd/packetrusher.go \
 && cp config/config.yml config.base.yml

FROM alpine:3.19
RUN apk add --no-cache iproute2 yq
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.base.yml /
