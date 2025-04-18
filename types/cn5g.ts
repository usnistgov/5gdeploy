import type { RequireExactlyOne } from "type-fest";

type GeneralRecord<K extends PropertyKey, T> = {
  general: T;
} & Partial<Record<K, T>>;

export interface Config {
  log_level: GeneralRecord<NFName, LogLevel>;
  register_nf: GeneralRecord<NFName, boolean>;
  nfs: Partial<Record<NFName, NF>>;
  database?: Database;
  snssais: SNSSAI[];
  dnns: DNN[];
  amf?: amf.Config;
  smf?: smf.Config;
  pcf?: pcf.Config;
  upf?: upf.Config;
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
    port?: number;
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
    support_features_options: Features;
    served_guami_list: GUAMI[];
    plmn_support_list: PLMN[];
    supported_integrity_algorithms: IntegrityAlgo[];
    supported_encryption_algorithms: EncryptionAlgo[];
    [k: string]: unknown;
  }

  export interface Features {
    enable_nssf: boolean;
    enable_smf_selection: boolean;
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

  export type IntegrityAlgo = "NIA0" | "NIA1" | "NIA2";
  export type EncryptionAlgo = "NEA0" | "NEA1" | "NEA2";
}

export namespace smf {
  export interface Config {
    support_features: Features;
    upfs: UPF[];
    smf_info: SMFInfo;
    local_subscription_infos: LocalSubscription[];
    [k: string]: unknown;
  }

  export interface Features {
    use_local_subscription_info: boolean;
    use_local_pcc_rules: boolean;
  }

  export interface UPF {
    host: string;
    upf_info?: upf.UPFInfo;
    config?: UPFConfig;
    [k: string]: unknown;
  }

  export interface UPFConfig {
    enable_usage_reporting?: boolean;
    n3_local_ipv4?: string;
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

export namespace upf {
  export interface Config {
    support_features: Features;
    remote_n6_gw: string;
    smfs: SMF[];
    upf_info: UPFInfo;
    [k: string]: unknown;
  }

  export interface Features {
    enable_bpf_datapath: boolean;
    enable_snat: boolean;
    [k: string]: unknown;
  }

  export interface SMF {
    host: string;
  }

  export interface UPFInfo {
    sNssaiUpfInfoList: SNSSAIInfo[];
  }

  export interface SNSSAIInfo {
    sNssai: SNSSAI;
    dnnUpfInfoList: DNNInfo[];
  }

  export interface DNNInfo {
    dnn: string;
    dnaiList?: string[];
    dnaiNwInstanceList?: Record<string, string>;
  }
}

export namespace pcf {
  export interface Config {
    local_policy: PolicyConfig;
  }

  export interface PolicyConfig {
    traffic_rules_path?: string; // folder of YAMLs with TrafficRules
    pcc_rules_path: string; // folder of YAMLs with PccRules
    policy_decisions_path: string; // folder of YAMLs with PolicyDecisions
    qos_data_path?: string;
  }

  export type TrafficRules = Record<string, TrafficControlData>;

  export interface TrafficControlData {
    routeToLocs: RouteToLocation[];
  }

  export interface RouteToLocation {
    dnai: string;
  }

  export type PccRules = Record<string, PccRule>;

  export interface PccRule {
    flowInfos: FlowInformation[];
    precedence: number;
    refTcData: string[]; // keyof TrafficRules
  }

  export interface FlowInformation {
    flowDescription: string;
  }

  export type PolicyDecisions = Record<string, PolicyDecision>;

  export type PolicyDecision = {
    pcc_rules: string[]; // keyof PccRules
  } & RequireExactlyOne<{
    supi_imsi: string;
    dnn: string;
    slice: Required<SNSSAI>;
    default: true;
  }>;
}
