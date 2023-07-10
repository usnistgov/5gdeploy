#!/bin/bash
set -euo pipefail
CT=$1

JQ_FUNCS='
def hex2number: split("") | reduce .[] as $d (0;
  (. * 16) + ("0123456789abcdef0123456789ABCDEF" | index($d) % 16)
);

def to_slice: if length == 8 then
  { sst: (.[0:2] | hex2number), sd: (.[2:] | hex2number) }
elif length == 2 then
  { sst: (. | hex2number) }
else
  ("bad S-NSSAI length\n" | halt_error)
end;

def to_session: split(":") | {
  type: "IPv4", apn: .[0], slice: (.[1] | to_slice)
};
'

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

gnb() {
  sleep 5
  msg Generating gnb.yaml
  dasel -f /UERANSIM/config/custom-gnb.yaml -w json | jq "$JQ_FUNCS"'
    .mcc |= (env.PLMN | split("-")[0]) |
    .mnc |= (env.PLMN | split("-")[1]) |
    .nci |= ("0x" + env.NCI) |
    .tac |= (env.TAC | hex2number) |
    .linkIp |= env.LINK_IP |
    .ngapIp |= env.NGAP_IP |
    .gtpIp |= env.GTP_IP |
    .amfConfigs |= (env.AMF_IPS | split(",") | map({ address:., port:38412 })) |
    .slices |= (env.SLICES | split(",") | map(to_slice)) |
  .' | tee /UERANSIM/gnb.yaml

  msg Starting 5G gNodeB
  exec /UERANSIM/build/nr-gnb -c /UERANSIM/gnb.yaml
}

ue() {
  sleep 10
  msg Generating ue.yaml
  dasel -f /UERANSIM/config/custom-ue.yaml -w json | jq "$JQ_FUNCS"'
    .mcc |= (env.PLMN | split("-")[0]) |
    .mnc |= (env.PLMN | split("-")[1]) |
    .supi |= ("imsi-" + env.IMSI) |
    .key |= env.KEY |
    .op |= (env.OP // env.OPC) |
    .opType |= (if env.OP then "OP" else "OPC" end) |
    .gnbSearchList |= (env.GNB_IPS | split(",")) |
    .["configured-nssai"] |= (env.SLICES | split(",") | map(to_slice)) |
    .["default-nssai"] |= (env.SLICES | split(",") | map(to_slice)) |
    .sessions |= (env.SESSIONS | split(",") | map(to_session)) |
  .' | tee /UERANSIM/ue.yaml

  msg Starting 5G UE
  exec /UERANSIM/build/nr-ue -c /UERANSIM/ue.yaml
}

$CT
