export interface Phoenix {
  Platform: unknown;
  Module: Module[];
}

export interface Module<T extends {} = any> {
  name: string;
  version: number;
  binaryFile: string;
  ignore?: boolean;
  config: T;
}

export interface ModuleConfigMap {
  amf: amf.Config;
  command: command.Config;
  gnb: gnb.Config;
  httpd: httpd.Config;
  json_rpc: {};
  monitoring: monitoring.Config;
  nrf_client: nrf_client.Config;
  pfcp: pfcp.Config;
  remote_command: {};
  rest_api: {};
  sdn_routing_topology: sdn_routing_topology.Config;
  smf: smf.Config;
  ue_5g_nas_only: ue_5g_nas_only.Config;
}

export interface PLMNID {
  mcc: string;
  mnc: string;
}

export interface SNSSAI {
  sst: number;
  sd?: string;
}

export interface Database {
  hostname: string;
  username: string;
  password: string;
  database: string;
}

export namespace amf {
  export interface Config {
    id: string;
    guami: GUAMI;
    trackingArea: TrackingArea[];
    hacks: Hacks;
    [k: string]: unknown;
  }

  export interface GUAMI extends PLMNID {
    regionId: number;
    amfSetId: number;
    amfPointer: number;
  }

  export interface TrackingArea extends PLMNID {
    taiList: TAI[];
  }

  export interface TAI {
    tac: number;
  }

  export interface Hacks {
    enable_reroute_nas: boolean;
    [k: string]: unknown;
  }
}

export namespace command {
  export interface Config {
    Acceptor: Acceptor[];
    DisablePrompt: boolean;
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
  export interface Config extends PLMNID {
    ngap_c_addr: string; // gNB N2 IP
    ngap_u_addr: string; // gNB N3 IP
    gnb_RAN_addr: string; // gNB air IP
    amf_addr?: never;
    amf_port?: never;
    amf_list: AMF[];
    gnb_id: number; // gNB ID
    cell_id: number; // NCI
    tac: number;
    slice?: SNSSAI;
    slice2?: SNSSAI;
    forwarding_worker: number;
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

export namespace monitoring {
  export interface Config {
    Prometheus?: Prometheus;
  }

  export interface Prometheus {
    listener: string;
    port: number;
    enabled: 0 | 1;
    register_memstat_to_metrics?: boolean;
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
    plmnList: PLMNID[];
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
    xdp?: XDP;
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

  export interface XDP {
    xdp_table_size: number;
    prog_path: string;
    interfaces: XDPInterface[];
  }

  export interface XDPInterface {
    type: InterfaceL3["type"];
    name: string;
  }

  export interface Associations {
    Acceptor: Acceptor[];
    Peer: Acceptor[];
    heartbeat_interval: number;
    max_heartbeat_retries: number;
    [k: string]: unknown;
  }

  export interface Acceptor {
    type: "udp";
    port: 8805;
    bind: string; // SMF/UPF N4 IP
  }

  export interface Hacks {
    qfi?: number;
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
  export interface Config extends PLMNID {
    Database: Database;
    id: string;
    mtu: 1456;
    startTeid: number;
    [k: string]: unknown;
  }
}

export namespace ue_5g_nas_only {
  export interface Config {
    usim: USIM;
    "usim-test-vector19"?: never;
    dn_list: DN[];
    DefaultNetwork: DefaultNetwork;
    Cell: Cell[];
    ip_tool: string;
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
    mcc: number;
    mnc: number;
    cell_id: number; // NCI
    gnb_cp_addr: string; // gNB air IP
    gnb_up_addr: string; // gNB air IP
    gnb_port: 10000;
  }
}
