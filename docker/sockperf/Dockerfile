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

RUN --mount=type=cache,id=bookworm-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=bookworm-apt-cache,target=/var/lib/apt,sharing=locked \
<<EOF
  set -euxo pipefail
  rm -f /etc/apt/apt.conf.d/docker-clean
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache
  apt-get update
  apt-get install -y --no-install-recommends gawk iproute2 jq
EOF

COPY --from=build /target/ /
COPY --from=build /sockperf/tools/gen2.awk /usr/local/bin/
