export interface Config extends PfcpifaceConf, ParserConf {
}

/**
 * pfcpiface.Conf struct.
 * @see {@link https://github.com/omec-project/upf/blob/c3aef0b7d3b5d5426e03bd82c4d41f465638f0d3/pfcpiface/config.go}
 */
export interface PfcpifaceConf {
  mode: Mode; // should be "" if enable_p4rt is true
  access: IfaceType;
  core: IfaceType;
  cpiface: CPIfaceInfo;
  p4rtciface?: unknown; // ignored if enable_p4rt is false
  enable_p4rt: boolean;
  enable_gtpu_path_monitoring: boolean;
  measure_flow: boolean;
  sim?: unknown;
  conn_timeout?: number; // unused
  read_timeout?: number;
  enable_notify_bess: boolean;
  enable_end_marker: boolean;
  notify_sockaddr?: string;
  endmarker_sockaddr?: string;
  log_level: LogLevel;
  qci_qos_config: QciQosConfig[];
  slice_rate_limit_config?: SliceMeterConfig; // if omitted, enable_slice_metering is disabled
  max_req_retries?: number;
  resp_timeout?: Duration;
  enable_hbTimer: boolean;
  heart_beat_interval?: Duration; // ignored if enable_hbTimer is false
  n4_addr?: never; // assigned internally
}

export type Duration = `${number}s`;

export type Mode = "af_xdp" | "af_packet" | "cndp" | "dpdk" | "sim" | "";

export interface IfaceType {
  // cndp_jsonc_file?: string;
  // ip_masquerade?: string;
  ifname: string;
}

export interface CPIfaceInfo {
  peers: string[];
  use_fqdn: boolean;
  hostname?: string; // ignored if use_fqdn is false
  http_port?: `${number}`; // default 8080
  dnn?: string;
  enable_ue_ip_alloc: boolean;
  ue_ip_pool?: string; // CIDR, ignored if enable_ue_ip_alloc is false
}

export type LogLevel = "panic" | "fatal" | "error" | "warn" | "info" | "debug";

export interface QciQosConfig {
  qci: number;
  cbs: number;
  pbs: number;
  ebs: number;
  burst_duration_ms: number;
  priority: number;
}

export interface SliceMeterConfig {
  n6_bps: number;
  n6_burst_bytes: number;
  n3_bps: number;
  n3_burst_bytes: number;
}

/**
 * parser.py config, omitted fields in PfcpifaceConf.
 * @see {@link https://github.com/omec-project/upf/blob/c3aef0b7d3b5d5426e03bd82c4d41f465638f0d3/conf/parser.py}
 */
export interface ParserConf {
  max_ip_defrag_flows?: number;
  ip_frag_with_eth_mtu?: number;
  gtppsc: boolean;
  hwcksum: boolean;
  ddp: boolean;
  measure_upf: boolean;
  workers: number;
  table_sizes: Record<TableSizeKey, number>;
}

export type TableSizeKey = "pdrLookup" | "flowMeasure" | "appQERLookup" | "sessionQERLookup" | "farLookup";
