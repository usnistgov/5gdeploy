FROM alpine:3.20
RUN apk add --no-cache arping docker-cli iproute2 jq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
# https://github.com/jpetazzo/pipework/pull/257
RUN sed -i 's/{print $5}/$4=="mtu"{print $5}/' /usr/local/bin/pipework
