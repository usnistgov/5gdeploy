FROM golang:1.21-alpine3.19 AS build
ADD https://github.com/omec-project/gnbsim/archive/ad6ee56afed1538a25792b401160a801decc28d3.zip /gnbsim.zip
RUN cd / \
 && unzip -n gnbsim.zip \
 && mv gnbsim-* gnbsim \
 && cd /gnbsim \
 && env CGO_ENABLED=0 go build . \
 && cp config/gnbsim.yaml config/config.base.yaml

FROM alpine:3.19
RUN apk add --no-cache iproute2 yq
COPY --from=build /gnbsim/gnbsim /gnbsim/config/config.base.yaml /
RUN yq -i 'del(.configuration.gnbs) | del(.configuration.customProfiles) | del(.configuration.profiles)' config.base.yaml
