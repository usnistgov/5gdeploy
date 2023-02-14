ARG BASE=ubuntu:focal
FROM ${BASE} AS build
COPY build.sh /
ARG SRSRAN_VERSION=22.10
RUN bash /build.sh ${SRSRAN_VERSION}

FROM ${BASE}
COPY --from=build /root/*.deb /root/
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iperf3 iproute2 iputils-ping jq mtr-tiny /root/*.deb \
 && rm -rf /var/lib/apt/lists/* \
 && srsran_install_configs.sh service
