export interface Config {
  log_level: Record<"general" | NFName, LogLevel>;
  register_nf: Record<"general" | NFName, boolean>;
  nfs: Record<NFName, NF>;
  database: Database;
  snssais: SNSSAI[];
  dnns: DNN[];
  amf?: amf.Config;
  smf?: smf.Config;
  [k: string]: unknown;
}

export type NFName = "pcf" | "nrf" | "smf" | "upf" | "amf" | "udm" | "udr" | "nssf" | "ausf" | "udsf";
export type LogLevel = "debug" | "info" | "warning" | "error" | "off";

export interface NF {
  host: string;
  sbi: NF.Interface;
  [net: `n${number}`]: NF.Interface;
}
export namespace NF {
  export interface Interface {
    interface_name: string;
    [k: string]: unknown;
  }
}

export interface Database {
  host: string;
  user: string;
  password: string;
  database_name: string;
  [k: string]: unknown;
}

export interface SNSSAI {
  sst: number;
  sd?: string;
}

export type PDUSessionType = "IPV4" | "IPV6" | "IPV4V6";

export interface DNN {
  dnn: string;
  pdu_session_type: PDUSessionType;
  ipv4_subnet?: string;
  ipv6_prefix?: string;
  ue_dns?: unknown;
}

export namespace amf {
  export interface Config {
    amf_name: string;
    served_guami_list: GUAMI[];
    plmn_support_list: PLMN[];
    [k: string]: unknown;
  }

  export interface GUAMI {
    mcc: string;
    mnc: string;
    amf_region_id: string;
    amf_set_id: string;
    amf_pointer: string;
  }

  export interface PLMN {
    mcc: string;
    mnc: string;
    tac: string;
    nssai: SNSSAI[];
  }
}

export namespace smf {
  export interface Config {
    upfs: UPF[];
    smf_info: SMFInfo[];
    local_subscription_infos: LocalSubscription[];
    [k: string]: unknown;
  }

  export interface UPF {
    host: string;
    [k: string]: unknown;
  }

  export interface SMFInfo {
    sNssaiSmfInfoList: SNSSAIInfo[];
  }

  export interface SNSSAIInfo {
    sNssai: SNSSAI;
    dnnSmfInfoList: Array<{ dnn: string }>;
  }

  export interface LocalSubscription {
    single_nssai: SNSSAI;
    dnn: string;
    qos_profile: {
      "5qi": number;
      session_ambr_ul: string;
      session_ambr_dl: string;
    };
  }
}
