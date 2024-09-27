FROM python:3.10-alpine3.20
SHELL ["/bin/ash", "-c"]
ADD https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-nwdaf/-/archive/master/oai-cn5g-nwdaf-master.zip /nwdaf.zip

RUN <<EOF
  set -euxo pipefail
  cd /
  unzip -n nwdaf.zip
  mv oai-cn5g-nwdaf-*/cli nwdaf-cli
EOF

WORKDIR /nwdaf-cli

RUN <<EOF
  set -euxo pipefail
  pip install -r ./requirements.txt
EOF

CMD ["tail", "-f"]
