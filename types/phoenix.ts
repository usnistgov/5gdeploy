export interface NetworkFunction {
  Phoenix: {
    Platform: unknown;
    Module: Module[];
  };
}

export interface Module<T extends {} = any> {
  name: string;
  version: number;
  binaryFile: string;
  config: T;
}

export interface ModuleConfigMap {
  amf: amf.Config;
  gnb: gnb.Config;
  sdn_routing_topology: sdn_routing_topology.Config;
  ue_5g_nas_only: ue_5g_nas_only.Config;
}

export namespace amf {
  export interface Config {
    trackingArea: TrackingArea[];
    [k: string]: unknown;
  }

  export interface TrackingArea {
    mcc: "%MCC";
    mnc: "%MNC";
    taiList: TAI[];
  }

  export interface TAI {
    tac: number;
  }
}

export namespace gnb {
  export interface Config {
    ngap_c_addr: string;
    ngap_u_addr: string;
    gnb_RAN_addr: string;
    amf_addr?: unknown;
    amf_port?: unknown;
    amf_list: AMF[];
    gnb_id: number;
    cell_id: number;
    mcc: "%MCC";
    mnc: "%MNC";
    tac: number;
    [k: string]: unknown;
  }

  export interface AMF {
    ngc_addr: string;
    ngc_sctp_port: 38412;
  }
}

export namespace sdn_routing_topology {
  export interface Config {
    static_mode: 1;
    Topology: {
      Link: Link[];
    };
  }

  export interface Link {
    weight?: number;
    Node_A: Node;
    Node_B: Node;
  }

  export type Node = gNB | UPF | DNN;
  export interface gNB {
    type: "gNodeB";
    id: number;
    ip: "255.255.255.255"; // no effect but prevents an error
  }
  export interface UPF {
    type: "UPF";
    id: string;
    port?: number;
    ip: string;
    external_ip?: string;
  }
  export interface DNN {
    type: "DNN";
    id: string;
    ip: "255.255.255.255"; // no effect but prevents an error
  }
}

export namespace ue_5g_nas_only {
  export interface Config {
    usim: USIM;
    "usim-test-vector19"?: unknown;
    dn_list: DN[];
    DefaultNetwork: DefaultNetwork;
    Cell: Cell[];
    [k: string]: unknown;
  }

  export interface USIM {
    supi: string;
    k: string;
    amf: string;
    opc: string;
    start_sqn: string;
  }

  export interface DN {
    dnn: string;
    dn_type: "IPv4" | "Ethernet";
  }

  export interface DefaultNetwork {
    dnn: string;
    enc_scheme: unknown;
  }

  export interface Cell {
    cell_id: number;
    mcc: "%MCC";
    mnc: "%MNC";
    gnb_cp_addr: string;
    gnb_up_addr: string;
    gnb_port: 10000;
  }
}
