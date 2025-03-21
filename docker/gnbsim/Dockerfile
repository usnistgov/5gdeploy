FROM golang:1.23-alpine3.21 AS build
SHELL ["/bin/ash", "-c"]
ADD https://github.com/omec-project/gnbsim/archive/2a68db04223d3b371a78933568492630477ed8b8.zip /gnbsim.zip

RUN --mount=type=cache,id=go1.23-build,target=/root/.cache/go-build,sharing=locked \
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
