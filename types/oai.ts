export interface RFSimulator {
  serveraddr: string;
  [k: string]: unknown;
}

export interface TelnetServer {
  listenaddr: string;
  listenport: number;
  [k: string]: unknown;
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogConfig {
  global_log_level: LogLevel;
  global_log_options?: string;

  f1ap_log_level?: LogLevel;
  gtpu_log_level?: LogLevel;
  hw_log_level?: LogLevel;
  m2ap_log_level?: LogLevel;
  m3ap_log_level?: LogLevel;
  mac_log_level?: LogLevel;
  mce_app_log_level?: LogLevel;
  mme_app_log_level?: LogLevel;
  ngap_log_level?: LogLevel;
  nr_mac_log_level?: LogLevel;
  nr_phy_log_level?: LogLevel;
  pdcp_log_level?: LogLevel;
  phy_log_level?: LogLevel;
  rlc_log_level?: LogLevel;
  rrc_log_level?: LogLevel;
  // git grep -nwE '\w+_log_level' ci-scripts/conf_files/ | awk '{print $2}' | sort -u
}

export namespace gnb {
  export interface Config {
    Active_gNBs: string[];
    gNBs: GNB[];
    rfsimulator: RFSimulator;
    telnetsrv?: TelnetServer;
    log_config?: LogConfig;
    [k: string]: unknown;
  }

  export interface GNB {
    gNB_ID: number;
    gNB_name: string;
    tracking_area_code: number;
    plmn_list: PLMN[];
    nr_cellid: number;
    amf_ip_address: AMF[];
    NETWORK_INTERFACES: NetworkInterfaces;
    [k: string]: unknown;
  }

  export interface PLMN {
    mcc: number;
    mnc: number;
    mnc_length: number;
    snssaiList: SNSSAI[];
    "snssaiList:dtype": "l";
  }

  export interface SNSSAI {
    sst: number;
    sd?: number;
  }

  export interface AMF {
    ipv4: string;
    ipv6: string;
    active: "yes";
    preference: "ipv4";
  }

  export interface NetworkInterfaces {
    GNB_INTERFACE_NAME_FOR_NG_AMF: string;
    GNB_IPV4_ADDRESS_FOR_NG_AMF: string;
    GNB_INTERFACE_NAME_FOR_NGU: string;
    GNB_IPV4_ADDRESS_FOR_NGU: string;
    GNB_PORT_FOR_S1U: 2152;
  }
}

export namespace ue {
  export interface Config {
    uicc0: UICC;
    rfsimulator?: RFSimulator;
    telnetsrv?: TelnetServer;
    log_config?: LogConfig;
  }

  export interface UICC {
    imsi: string;
    nmc_size: number;
    key: string;
    opc: string;
    dnn: string;
    nssai_sst: number;
    nssai_sd?: number;
  }
}
