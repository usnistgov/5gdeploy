FROM buildpack-deps:jammy AS build
SHELL ["/bin/bash", "-c"]

RUN --mount=type=cache,id=jammy-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=jammy-apt-cache,target=/var/lib/apt,sharing=locked \
<<EOF
  set -euxo pipefail
  rm -f /etc/apt/apt.conf.d/docker-clean
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache
  apt-get update
  apt-get install -y --no-install-recommends libgsl-dev libns3-dev
EOF

COPY main.cpp /app/
RUN <<EOF
  set -euxo pipefail
  cd /app
  g++ -std=c++17 -Wall -o ns3http main.cpp -I/usr/include/ns3.35 \
    $(find /usr/lib/x86_64-linux-gnu/ -name 'libns3.35-*.so' -printf ' %f' | sed -e 's/lib/-l/g' -e 's/\.so//g')
EOF


FROM ubuntu:jammy
SHELL ["/bin/bash", "-c"]

RUN --mount=type=cache,id=jammy-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=jammy-apt-cache,target=/var/lib/apt,sharing=locked \
<<EOF
  set -euxo pipefail
  rm -f /etc/apt/apt.conf.d/docker-clean
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache
  apt-get update
  apt-get install -y --no-install-recommends iproute2 iptables jq libns3-3v5 ns3
EOF

COPY --from=build /app/ns3http /usr/local/bin/
