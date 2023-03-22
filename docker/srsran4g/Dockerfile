ARG BASE=ubuntu:22.04
FROM ${BASE} AS build
COPY build.sh /
ARG SRSRAN_VERSION=22.10
RUN bash /build.sh ${SRSRAN_VERSION}

FROM ${BASE}
ADD https://docs.srsran.com/projects/4g/en/latest/_downloads/4515ae5475fe95ec64b5279ee5208c3f/ue.conf \
    https://docs.srsran.com/projects/4g/en/latest/_downloads/8e5a2f6b908efdb8de7b32e152847da2/rr.conf \
    https://docs.srsran.com/projects/4g/en/latest/_downloads/01cdb869abc6f80f8a2d9585af09b28b/enb.conf \
    https://docs.srsran.com/projects/4g/en/latest/_downloads/08e07e471618299bcb10635b0143cb1f/amf.yaml \
    https://docs.srsran.com/projects/4g/en/latest/_downloads/f9220340dd79000b7e8bd5702f5a29cf/upf.yaml \
    /usr/local/share/srsran/5g_sa_E2E/
COPY --from=build /root/*.deb /root/
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iperf3 iproute2 iptables iputils-ping jq mtr-tiny netcat-openbsd python-is-python3 python3-minimal socat /root/*.deb \
 && rm -rf /var/lib/apt/lists/* \
 && srsran_install_configs.sh service
ADD --chmod=755 ini.py /usr/local/bin/
ADD --chmod=755 entrypoint.sh /
