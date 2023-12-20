FROM golang:1.21-alpine3.18 AS build
RUN cd / \
 && wget -O PacketRusher.zip https://github.com/HewlettPackard/PacketRusher/archive/c10560874c0bbd8241f75c5aaa44536b528e1d74.zip \
 && unzip -n PacketRusher.zip \
 && mv PacketRusher-* PacketRusher \
 && cd /PacketRusher \
 && env CGO_ENABLED=0 go build cmd/packetrusher.go \
 && cp config/config.yml config.default.yml

FROM alpine:3.18
RUN apk add --no-cache iproute2 yq
COPY --from=build /PacketRusher/packetrusher /PacketRusher/config.default.yml /
