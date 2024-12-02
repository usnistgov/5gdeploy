export interface Slice {
  sst: number;
  sd: number;
}

export interface GnbConfig {
  gnb_id?: number;
  gnb_id_bit_length?: number;
  ran_node_name?: string;
  gnb_db_id?: number;
  qos?: unknown;
  srbs?: unknown;
  cu_cp: CUCP;
  cu_up: CUUP;
  du?: unknown;
  cell_cfg: Cell;
  cells?: Array<Partial<Cell>>;
  e2?: unknown;
  ntn?: unknown;
  ru_ofh?: unknown;
  ru_sdr: RUSDR;
  ru_dummy?: unknown;
  fapi?: unknown;
  hal?: unknown;
  buffer_pool?: unknown;
  expert_phy?: unknown;
  expert_execution?: unknown;
  test_mode?: unknown;
  log?: Log;
  pcap?: unknown;
  metrics?: unknown;
}

export interface CUCP {
  amf: CUCP.AMF;
  inactivity_timer?: number;
  [k: string]: unknown;
}
export namespace CUCP {
  export interface AMF {
    addr: string;
    bind_addr?: string; // gNB N2 IP
    supported_tracking_areas: SupportedTrackingArea[];
    [k: string]: unknown;
  }

  export interface SupportedTrackingArea {
    tac: number;
    plmn_list: PlmnItem[];
  }

  export interface PlmnItem {
    plmn: string;
    tai_slice_support_list: Slice[];
  }
}

export interface CUUP {
  upf: CUUP.UPF;
  [k: string]: unknown;
}
export namespace CUUP {
  export interface UPF {
    bind_addr?: string; // gNB N3 IP
    [k: string]: unknown;
  }
}

export interface E2 {
  enable_cu_e2: boolean;
  [k: string]: unknown;
}

export interface RUSDR {
  srate: number;
  device_driver: "uhd" | "zmq";
  device_args?: string;
  tx_gain: number;
  rx_gain?: number;
  [k: string]: unknown;
}

export interface Cell {
  pci: number;
  dl_arfcn: number;
  band?: "auto" | number;
  common_scs: number;
  channel_bandwidth_MHz: number;
  plmn: string;
  tac: number;
  slicing?: Cell.SliceCfg[];
  [k: string]: unknown;
}
export namespace Cell {
  export interface SliceCfg extends Slice {
    sched_cfg?: SchedCfg;
  }

  export interface SchedCfg {
    min_prb_policy_ratio: number;
    max_prb_policy_ratio: number;
  }
}

export interface Log {
  filename?: string;
  all_level?: Log.Level;
  tracing_filename?: string;
  [k: string]: unknown;
}
export namespace Log {
  export type Level = "none" | "error" | "warning" | "info" | "debug";
}
