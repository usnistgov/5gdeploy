FROM golang:1.22-alpine3.19 AS build
ADD https://github.com/omec-project/gnbsim/archive/6d9d4e002877b090fcdc6b388c0d1d86f2c51801.zip /gnbsim.zip
RUN cd / \
 && unzip -n gnbsim.zip \
 && mv gnbsim-* gnbsim \
 && cd /gnbsim \
 && env CGO_ENABLED=0 go build . \
 && cp config/gnbsim.yaml config/config.base.yaml

FROM alpine:3.19
RUN apk add --no-cache iproute2 yq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
COPY --from=build /gnbsim/gnbsim /gnbsim/config/config.base.yaml /
RUN yq -i 'del(.configuration.gnbs) | del(.configuration.customProfiles) | del(.configuration.profiles)' config.base.yaml
