FROM buildpack-deps:bookworm AS build
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  cd /
  git clone --single-branch --branch 2-2-1 --depth 1 https://git.code.sf.net/p/iperf2/code iperf2
  cd /iperf2
  ./configure
  make
  make install DESTDIR=/target
EOF

FROM gcr.io/distroless/cc-debian12
SHELL ["/bin/bash", "-c"]
COPY --from=build /target/ /
ENTRYPOINT ["/usr/local/bin/iperf"]
