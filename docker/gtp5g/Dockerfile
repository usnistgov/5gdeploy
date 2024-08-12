FROM alpine:3.20 AS src
SHELL ["/bin/ash", "-c"]
ADD https://github.com/free5gc/gtp5g/archive/v0.8.10.zip /gtp5g.zip

RUN <<EOF
  set -euxo pipefail
  cd /
  unzip -n gtp5g.zip
  mv gtp5g-* gtp5g
  cd /gtp5g
EOF


FROM buildpack-deps:jammy
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends kmod
  rm -rf /var/lib/apt/lists/*
EOF

COPY --from=src --link /gtp5g /gtp5g
COPY --chmod=755 gtp5g-load.sh /
ENTRYPOINT ["/gtp5g-load.sh"]
