#!/bin/bash
set -euo pipefail
CT=$1

msg() {
  echo -ne "\e[35m[5gdeploy] \e[94m"
  echo -n "$*"
  echo -e "\e[0m"
}

ue_route() {
  local NETIF=$(ini.py /etc/srsran/ue.conf gw.ip_devname)
  if [[ -z $NETIF ]]; then
    NETIF=tun_srsue
  fi
  msg UE netif is $NETIF

  msg Waiting for UE netif to appear
  while true; do
    sleep 1
    local UEIP=$(ip -j addr | jq -r --arg NETIF $NETIF '.[] | select(.ifname==$NETIF).addr_info[].local')
    if [[ -n $UEIP ]]; then
      msg UE IP address is $UEIP
      msg Changing default route
      ip route replace default dev $NETIF src $UEIP
      return
    fi
  done
}

lte_epc() {
  msg Enabling NAT on Internet connection
  ip route replace default via 192.168.250.1
  iptables -t nat -A POSTROUTING -s $(ini.py /etc/srsran/epc.conf spgw.sgi_if_addr)/16 -j SNAT --to 192.168.250.20

  ini.py /etc/srsran/epc.conf \
    log.filename=/srsran-log/epc.log \
    mme.mme_bind_addr=192.168.12.20 \
    spgw.gtpu_bind_addr=192.168.12.20

  msg Starting LTE EPC
  exec srsepc /etc/srsran/epc.conf
}

lte_enb() {
  ini.py /etc/srsran/enb.conf \
    log.filename=/srsran-log/enb.log \
    pcap.enable=false \
    expert.metrics_csv_enable=false \
    expert.report_json_enable=false \
    enb.mme_addr=192.168.12.20 \
    enb.gtp_bind_addr=192.168.12.50 \
    enb.s1c_bind_addr=192.168.12.50 \
    rf.device_name=zmq \
    rf.device_args=fail_on_disconnect=true,tx_port=tcp://*:2000,rx_port=tcp://192.168.10.55:2001,id=enb,base_srate=23.04e6

  msg Starting LTE eNodeB
  exec srsenb /etc/srsran/enb.conf
}

lte_ue() {
  ini.py /etc/srsran/ue.conf \
    log.filename=/srsran-log/ue.log \
    pcap.enable=none \
    general.metrics_csv_enable=false \
    general.metrics_json_enable=false \
    rf.device_name=zmq \
    rf.device_args=tx_port=tcp://*:2001,rx_port=tcp://192.168.10.50:2000,id=ue,base_srate=23.04e6

  msg Starting LTE UE
  ue_route &
  exec srsue /etc/srsran/ue.conf
}

5g_gnb() {
  msg Inserting NAT rule for N2 connection
  iptables -t nat -I POSTROUTING -s $GNB_N3_IP -d $AMF_N2_IP -j SNAT --to-source $GNB_N2_IP

  msg Setting PLMN $MCC:$MNC:$TAC
  sed -i '/nr_cell_list/,/^);$/ s|tac = .*;|tac = '$TAC';|' /etc/srsran/rr.conf
  ini.py /etc/srsran/enb.conf \
    log.filename=/srsran-log/enb.log \
    pcap.enable=false \
    expert.metrics_csv_enable=false \
    expert.report_json_enable=false \
    expert.rrc_inactivity_timer=86400000 \
    enb.enb_id=$GNB_ID \
    enb.mcc=$MCC \
    enb.mnc=$MNC \
    enb.mme_addr=$AMF_N2_IP \
    enb.gtp_bind_addr=$GNB_N3_IP \
    rf.device_name=zmq \
    rf.device_args=fail_on_disconnect=true,tx_port=tcp://*:2000,rx_port=tcp://192.168.10.55:2001,id=enb,base_srate=23.04e6

  sleep 30
  msg Starting 5G gNodeB
  exec srsenb /etc/srsran/enb.conf
}

5g_ue() {
  ini.py /etc/srsran/ue.conf \
    log.filename=/srsran-log/ue.log \
    pcap.enable=none \
    general.metrics_csv_enable=false \
    general.metrics_json_enable=false \
    usim.imsi=$USIM_IMSI \
    usim.k=$USIM_K \
    usim.op=$USIM_OP \
    usim.opc=$USIM_OPC \
    usim.algo=$USIM_ALGO \
    nas.apn=$DNN \
    gw.netns= \
    rf.device_name=zmq \
    rf.device_args=tx_port=tcp://*:2001,rx_port=tcp://192.168.10.50:2000,id=ue,base_srate=23.04e6

  sleep 30
  msg Starting 5G UE
  ue_route &
  exec srsue /etc/srsran/ue.conf
}

if [[ $CT == 5g* ]]; then
  cp /usr/local/share/srsran/5g_sa_E2E/* /etc/srsran/
fi
$CT
