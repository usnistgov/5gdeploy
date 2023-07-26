ARG BASE
FROM ${BASE}
RUN sed -i \
    -e '/security/! s|mirror://mirrors.ubuntu.com/mirrors.txt|http://archive.ubuntu.com/ubuntu|' \
    -e '/security/  s|mirror://mirrors.ubuntu.com/mirrors.txt|http://security.ubuntu.com/ubuntu|' \
    /etc/apt/sources.list \
 && apt-get update \
 && env DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends iperf3 iptables jq mtr-tiny netcat-openbsd traceroute \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT []
ADD --chmod=755 entrypoint.sh /
