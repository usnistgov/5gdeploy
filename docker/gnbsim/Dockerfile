FROM golang:1.24-alpine3.21 AS build
SHELL ["/bin/ash", "-c"]
ADD https://github.com/omec-project/gnbsim/archive/f8620750996a966ffc5e674d54a014ef67a595ec.zip /gnbsim.zip

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
