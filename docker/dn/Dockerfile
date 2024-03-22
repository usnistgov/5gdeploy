FROM alpine:3.19
RUN apk add --no-cache iproute2 iptables jq mtr
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/8a24c61bd731a78f571a9cec80bd2447a5c1cf62/pipework /usr/local/bin/
