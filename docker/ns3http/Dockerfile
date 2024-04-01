FROM buildpack-deps:jammy AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgsl-dev libns3-dev \
 && rm -rf /var/lib/apt/lists/*
COPY main.cpp compile.sh /app/
RUN bash /app/compile.sh

FROM ubuntu:jammy
RUN apt-get update \
 && apt-get install -y --no-install-recommends iproute2 iptables jq libns3-3v5 ns3 \
 && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/12998f32a6abf13ba182dc93615a96c8e27cc5c9/pipework /usr/local/bin/
COPY --from=build /app/ns3http /usr/local/bin/
ADD --chmod=755 entrypoint.sh /
ENTRYPOINT ["/entrypoint.sh"]
