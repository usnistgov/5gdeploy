export interface Phoenix {
  Platform: unknown;
  Module: Module[];
}

export interface Module<T extends {} = any> {
  name: string;
  version: number;
  binaryFile: string;
  config: T;
}

export interface ModuleConfigMap {
  amf: amf.Config;
  command: command.Config;
  gnb: gnb.Config;
  httpd: httpd.Config;
  nrf_client: nrf_client.Config;
  pfcp: pfcp.Config;
  sdn_routing_topology: sdn_routing_topology.Config;
  smf: smf.Config;
  ue_5g_nas_only: ue_5g_nas_only.Config;
}

export interface SNSSAI {
  sst: number;
  sd?: string;
}

export namespace amf {
  export interface Config {
    id: string;
    guami: GUAMI;
    trackingArea: TrackingArea[];
    [k: string]: unknown;
  }

  export interface GUAMI {
    mcc: "%MCC";
    mnc: "%MNC";
    regionId: number;
    amfSetId: number;
    amfPointer: number;
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

export namespace command {
  export interface Config {
    Acceptor: Acceptor[];
    GreetingText: string;
    [k: string]: unknown;
  }

  export interface Acceptor {
    bind: string;
    port: number;
    type: "udp";
  }
}

export namespace gnb {
  export interface Config {
    ngap_c_addr: string; // gNB N2 IP
    ngap_u_addr: string; // gNB N3 IP
    gnb_RAN_addr: string; // gNB air IP
    amf_addr?: never;
    amf_port?: never;
    amf_list: AMF[];
    gnb_id: number; // gNB ID
    cell_id: number; // NCGI
    mcc: "%MCC";
    mnc: "%MNC";
    tac: number;
    slice?: SNSSAI;
    slice2?: SNSSAI;
    [k: string]: unknown;
  }

  export interface AMF {
    ngc_addr: string; // AMF N2 IP
    ngc_sctp_port: 38412;
  }
}

export namespace httpd {
  export interface Config {
    Acceptor: Acceptor[];
    [k: string]: unknown;
  }

  export interface Acceptor {
    bind: string;
    port: number;
    [k: string]: unknown;
  }
}

export namespace nrf_client {
  export interface Config {
    nf_profile: Profile;
    [k: string]: unknown;
  }

  export interface Profile {
    nfType: string;
    nfInstanceId: string;
    sNssais: SNSSAI[];
    [k: string]: unknown;
  }
}

export namespace pfcp {
  export type Config = UP | CP;

  export interface CP {
    mode: "CP";
    LocalNodeID: NodeID;
    Associations: Associations;
    [k: string]: unknown;
  }

  export interface UP {
    mode: "UP";
    data_plane_mode: "integrated";
    ethernet_session_identifier?: string;
    LocalNodeID: NodeID;
    DataPlane: DataPlane;
    Associations: Associations;
    hacks: Hacks;
    [k: string]: unknown;
  }

  export interface NodeID {
    IPv4: string;
  }

  export interface DataPlane {
    threads: number;
    interfaces: Interface[]; // up to 8 items
    xdp?: never;
  }

  export type Interface = InterfaceL3 | InterfaceL2;

  interface InterfaceCommon {
    name: string; // UPF netif name
    mode: "single_thread" | "thread_pool";
  }

  export interface InterfaceL3 extends InterfaceCommon {
    type: "n3_n9" | "n6_l3" | "n3_n9_n6_l3";
    bind_ip: string; // UPF N3/N9/N6 IP
  }

  export interface InterfaceL2 extends InterfaceCommon {
    type: "n6_l2";
  }

  export interface Associations {
    Acceptor: Acceptor[];
    Peer: Acceptor[];
    [k: string]: unknown;
  }

  export interface Acceptor {
    type: "udp";
    port: 8805;
    bind: string; // SMF/UPF N4 IP
  }

  export interface Hacks {
    qfi: number;
    [k: string]: unknown;
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
    id: number; // gNB ID
    ip: "255.255.255.255"; // no effect but prevents an error
  }
  export interface UPF {
    type: "UPF";
    id: string; // UPF N4 IP
    port?: number;
    ip: string; // UPF N6/N3/N9 IP toward DNN/gNB/UPF
    external_ip?: string;
  }
  export interface DNN {
    type: "DNN";
    id: string; // DNN
    ip: "255.255.255.255"; // no effect but prevents an error
  }
}

export namespace smf {
  export interface Config {
    id: string;
    mtu: 1456;
    startTeid: number;
    [k: string]: unknown;
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
    op?: never;
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
    cell_id: number; // NCGI
    mcc: "%MCC";
    mnc: "%MNC";
    gnb_cp_addr: string; // gNB air IP
    gnb_up_addr: string; // gNB air IP
    gnb_port: 10000;
  }
}
