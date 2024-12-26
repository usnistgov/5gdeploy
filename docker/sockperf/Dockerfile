FROM buildpack-deps:bookworm AS build
SHELL ["/bin/bash", "-c"]
ADD https://github.com/Mellanox/sockperf/archive/19accb5229503dac7833f03713b978cb7fc48762.zip /sockperf.zip

RUN <<EOF
  set -euxo pipefail
  cd /
  unzip -n sockperf.zip
  mv sockperf-* sockperf
  cd /sockperf
  ./autogen.sh
  ./configure
  make
  make install DESTDIR=/target
EOF

FROM debian:bookworm
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends gawk iproute2 jq
  rm -rf /var/lib/apt/lists/*
EOF

COPY --from=build /target/ /
COPY --from=build /sockperf/tools/gen2.awk /usr/local/bin/
