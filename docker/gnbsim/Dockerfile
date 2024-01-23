FROM omecproject/5gc-gnbsim:main-1caccfc
RUN apk add --no-cache yq
ADD https://github.com/omec-project/gnbsim/raw/1caccfcaac9b718d987aff378212614e4fe634fb/config/gnbsim.yaml /gnbsim/config/base.yaml
WORKDIR /gnbsim
RUN yq -i 'del(.configuration.gnbs) | del(.configuration.customProfiles) | del(.configuration.profiles)' config/base.yaml
