// https://github.com/edgecomllc/eupf/blob/54ed069c6cdf1da18b09bd78cb166bc4e4dd1ceb/cmd/config/config.go#L13-L39
export interface Config {
  interface_name: string[];
  xdp_attach_mode?: XdpAttachMode;
  api_address?: string; // [IP]:port
  pfcp_address?: string; // [IP]:port
  pfcp_node_id?: string; // IPv4
  pfcp_remote_node?: string[];
  association_setup_timeout?: number;
  metrics_address?: string; // [IP]:port
  n3_address: string;
  n9_address: string;
  gtp_peer?: string[]; // IP:port
  gtp_echo_interval?: number;
  qer_map_size?: number;
  far_map_size?: number;
  urr_map_size?: number;
  pdr_map_size?: number;
  resize_ebpf_maps?: boolean;
  heartbeat_retries?: number;
  heartbeat_interval?: number; // seconds
  heartbeat_timeout?: number; // seconds
  logging_level?: LogLevel;
  ueip_pool?: string; // CIDR
  teid_pool?: number;
  feature_ueip?: boolean;
  feature_ftup?: boolean;
}

export type XdpAttachMode = "generic" | "native" | "offload";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "panic";
