FROM debian:bookworm
RUN apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iproute2 jq \
 && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 entrypoint.sh /
