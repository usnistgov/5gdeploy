FROM python:3.10-alpine3.21
SHELL ["/bin/ash", "-c"]
ARG TAG=http2_server_support
ADD https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-nwdaf/-/archive/$TAG/oai-cn5g-nwdaf-$TAG.zip?path=cli /nwdaf.zip

RUN <<EOF
  set -euxo pipefail
  cd /
  unzip -n nwdaf.zip
  mv oai-cn5g-nwdaf-*/cli nwdaf-cli
  rm -rf nwdaf.zip oai-cn5g-nwdaf-*
EOF

WORKDIR /nwdaf-cli

RUN <<EOF
  set -euxo pipefail
  apk add --no-cache jq moreutils
  pip install --no-cache-dir -r ./requirements.txt
EOF
