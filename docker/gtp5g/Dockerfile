ARG BUILDPACK_TAG=noble
FROM buildpack-deps:$BUILDPACK_TAG
SHELL ["/bin/bash", "-c"]

RUN --mount=type=cache,id=gtp5g-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=gtp5g-apt-cache,target=/var/lib/apt,sharing=locked \
<<EOF
  set -euxo pipefail
  rm -f /etc/apt/apt.conf.d/docker-clean
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache
  apt-get update
  apt-get install -y --no-install-recommends kmod
EOF

ADD https://github.com/free5gc/gtp5g/archive/v0.9.13.zip /gtp5g.zip
COPY --chmod=755 gtp5g-load.sh /
ENTRYPOINT ["/gtp5g-load.sh"]
