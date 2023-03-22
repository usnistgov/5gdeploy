ARG BASE=ubuntu:22.04
FROM ${BASE} AS build
COPY build.sh /
ARG SRSRAN_VERSION=22.10
RUN bash /build.sh ${SRSRAN_VERSION}

FROM ${BASE}
COPY --from=build /root/*.deb /root/
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iperf3 iproute2 iptables iputils-ping jq mtr-tiny python-is-python3 python3-minimal /root/*.deb \
 && rm -rf /var/lib/apt/lists/* \
 && srsran_install_configs.sh service
ADD --chmod=755 ini.py /usr/local/bin/
ADD --chmod=755 entrypoint.sh /
