#!/bin/bash
set -euo pipefail
CT=$1

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

gnb() {
  sleep 5
  msg Generating gnb.yaml
  dasel -f /UERANSIM/config/custom-gnb.yaml -w json | jq '
  def hex2number: split("") | reduce .[] as $d (0;
    (. * 16) + ({"0":0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"a":10,"A":10,"b":11,"B":11,"c":12,"C":12,"d":13,"D":13,"e":14,"E":14,"f":15,"F":15})[$d]
  );

  .mcc |= env.MCC |
  .mnc |= env.MNC |
  .nci |= env.NCI |
  .tac |= env.TAC |
  .linkIp |= env.LINK_IP |
  .ngapIp |= env.NGAP_IP |
  .gtpIp |= env.GTP_IP |
  .amfConfigs |= (env.AMF_IPS | split(",") | map({ address:., port:38412 })) |
  .slices |= (env.SLICES | split(",") | map(
    split(":") | if length == 2 then
      { sst: (.[0] | hex2number), sd: (.[1] | hex2number) }
    else
      { sst: (.[0] | hex2number) }
    end
  )) |
  .' | tee /UERANSIM/gnb.yaml

  msg Starting 5G gNodeB
  exec /UERANSIM/build/nr-gnb -c /UERANSIM/gnb.yaml
}

ue() {
  sleep 10
  msg Generating ue.yaml
  dasel -f /UERANSIM/config/custom-ue.yaml -w json | jq '
  def hex2number: split("") | reduce .[] as $d (0;
    (. * 16) + ({"0":0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"a":10,"A":10,"b":11,"B":11,"c":12,"C":12,"d":13,"D":13,"e":14,"E":14,"f":15,"F":15})[$d]
  );

  def to_slice: split(":") | if length == 2 then
    { sst: (.[0] | hex2number), sd: (.[1] | hex2number) }
  else
    { sst: (.[0] | hex2number) }
  end;

  def to_session: split(":") | {
    type: "IPv4", apn: .[0], slice: (.[1:] | join(":") | to_slice)
  };

  .supi |= ("imsi-" + env.IMSI) |
  .mcc |= env.MCC |
  .mnc |= env.MNC |
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
