FROM alpine:3.19
RUN apk add --no-cache arping docker-cli iproute2 jq
ADD --chmod=755 https://github.com/jpetazzo/pipework/raw/12998f32a6abf13ba182dc93615a96c8e27cc5c9/pipework /usr/local/bin/
RUN sed -i '/^#!/ s|bash|ash|' /usr/local/bin/pipework
