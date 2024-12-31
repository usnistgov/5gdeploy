FROM golang:1.23-alpine3.21 AS build
SHELL ["/bin/ash", "-c"]
ADD https://github.com/omec-project/gnbsim/archive/db4bb0dae95c876be2a61b56a30c14e40a040176.zip /gnbsim.zip

RUN <<EOF
  set -euxo pipefail
  cd /
  unzip -n gnbsim.zip
  mv gnbsim-* gnbsim
  cd /gnbsim
  env CGO_ENABLED=0 go build .
  cp config/gnbsim.yaml config/config.base.yaml
EOF


FROM alpine:3.21
RUN apk add --no-cache ethtool iproute2 yq
COPY --from=build /gnbsim/gnbsim /gnbsim/config/config.base.yaml /
RUN yq -i 'del(.configuration.gnbs) | del(.configuration.customProfiles) | del(.configuration.profiles)' config.base.yaml
