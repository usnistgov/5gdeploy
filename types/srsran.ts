export namespace gnb {
  export interface Config {
    gnb_id?: number;
    gnb_id_bit_length?: number;
    ran_node_name?: string;
    slicing?: Slice[];
    amf: AMF;
    ru_sdr: RUSDR;
    cell_cfg: Cell;
    cells?: Array<Partial<Cell>>;
    log?: Log;
    [k: string]: unknown;
  }

  export interface Slice {
    sst: number;
    sd?: number;
  }

  export interface AMF {
    addr: string;
    bind_addr: string;
    n2_bind_addr?: string;
    n3_bind_addr?: string;
    [k: string]: unknown;
  }

  export interface RUSDR {
    srate: string;
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
    [k: string]: unknown;
  }

  export type LogLevel = "none" | "error" | "warning" | "info" | "debug";

  export interface Log {
    filename?: string;
    all_level?: LogLevel;
    tracing_filename?: string;
    [k: string]: unknown;
  }
}
