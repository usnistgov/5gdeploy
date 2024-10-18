FROM buildpack-deps:bookworm AS build
SHELL ["/bin/bash", "-c"]
ADD https://sourceforge.net/code-snapshots/git/i/ip/iperf2/code.git/iperf2-code-407d47dd3b5624c27880f495b03dd8c816b0a4c2.zip /iperf2.zip

RUN <<EOF
  set -euxo pipefail
  cd /
  unzip -n iperf2.zip
  mv iperf2-* iperf2
  cd /iperf2
  ./configure
  make
  make install DESTDIR=/target
EOF

FROM gcr.io/distroless/cc-debian12
SHELL ["/bin/bash", "-c"]
COPY --from=build /target/ /
ENTRYPOINT ["/usr/local/bin/iperf"]
