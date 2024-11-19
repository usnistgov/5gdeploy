FROM alpine:3.20
RUN apk add --no-cache arping docker-cli ethtool iproute2 jq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/9ba97f1735022fb5f811d9c2a304dda33fae1ad1/pipework /usr/local/bin/
COPY --chmod=755 ctns.sh toeplitz.sh /usr/local/bin/
