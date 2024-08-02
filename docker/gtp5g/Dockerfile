FROM buildpack-deps:jammy
SHELL ["/bin/bash", "-c"]

RUN <<EOF
  set -euxo pipefail
  apt-get update
  apt-get install -y --no-install-recommends kmod
  rm -rf /var/lib/apt/lists/*
EOF

RUN <<EOF
  set -euxo pipefail
  git clone --single-branch --branch v0.8.10 https://github.com/free5gc/gtp5g.git /gtp5g
  # ADD git repository does not support proxy, https://github.com/moby/buildkit/issues/4643
EOF

COPY --chmod=755 gtp5g-load.sh /
ENTRYPOINT ["/gtp5g-load.sh"]
