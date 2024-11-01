FROM crazymax/yasu AS yasu

FROM gradiant/open5gs:2.7.2
COPY --from=yasu /usr/local/bin/yasu /usr/local/bin/yasu
ADD --chmod=755 https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64 /usr/local/bin/yq
