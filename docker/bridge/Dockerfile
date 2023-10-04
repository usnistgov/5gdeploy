FROM alpine:3.18
RUN apk add --no-cache arping docker-cli iproute2 jq
# https://github.com/jpetazzo/pipework/pull/249
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/4cd807fc17417633018d800759a2fa78f510dfb5/pipework /usr/local/bin/
