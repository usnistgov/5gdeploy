FROM alpine:3.18
RUN apk add --no-cache arping docker-cli iproute2 jq
# https://github.com/jpetazzo/pipework/pull/249
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/439aa9cd4a2631ef3dbbd8118bc432ac57d842d9/pipework /usr/local/bin/
