FROM buildpack-deps:jammy
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends kmod
  rm -rf /var/lib/apt/lists/*
EOF

ADD https://github.com/free5gc/gtp5g.git#v0.8.10 /gtp5g
COPY --chmod=755 load.sh /
ENTRYPOINT ["/load.sh"]
