FROM golang:1.22-alpine3.19 AS build
ADD https://github.com/omec-project/gnbsim/archive/fe658daf3596437117e30e997fb076b83e89e163.zip /gnbsim.zip
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
