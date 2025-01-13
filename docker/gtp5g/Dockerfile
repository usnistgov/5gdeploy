ARG BUILDPACK_TAG=jammy
FROM buildpack-deps:$BUILDPACK_TAG
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends kmod
  rm -rf /var/lib/apt/lists/*
EOF

ADD https://github.com/free5gc/gtp5g/archive/v0.9.7.zip /gtp5g.zip
COPY --chmod=755 gtp5g-load.sh /
ENTRYPOINT ["/gtp5g-load.sh"]
