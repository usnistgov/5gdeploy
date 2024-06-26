FROM golang:1.22-alpine3.20 AS build
SHELL ["/bin/ash", "-c"]
ADD https://github.com/omec-project/gnbsim/archive/b8819f1aa976443dd0bd85684663cb1c35e847a4.zip /gnbsim.zip

RUN <<EOF
  set -euxo pipefail
  cd /
  unzip -n gnbsim.zip
  mv gnbsim-* gnbsim
  cd /gnbsim
  env CGO_ENABLED=0 go build .
  cp config/gnbsim.yaml config/config.base.yaml
EOF


FROM alpine:3.20
RUN apk add --no-cache iproute2 yq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
COPY --from=build /gnbsim/gnbsim /gnbsim/config/config.base.yaml /
RUN yq -i 'del(.configuration.gnbs) | del(.configuration.customProfiles) | del(.configuration.profiles)' config.base.yaml
