FROM golang:1.24-alpine3.21 AS build
SHELL ["/bin/ash", "-c"]
ARG TAG=d3fce7e35a69b9f5d670242a93b7d1bee8842ecf
ADD https://github.com/omec-project/gnbsim/archive/${TAG}.zip /gnbsim.zip

RUN --mount=type=cache,id=go1.24-build,target=/root/.cache/go-build,sharing=locked \
<<EOF
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
