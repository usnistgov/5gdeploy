FROM alpine:3.19
RUN apk add --no-cache arping docker-cli iproute2 jq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/34f48f37c7b748a51dea79e4b6ab6a5028a02485/pipework /usr/local/bin/
