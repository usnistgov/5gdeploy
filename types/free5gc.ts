export interface Root<Configuration extends {}> {
  info: Info;
  configuration: Configuration;
  logger: Logger;
}

export interface Info {
  version: string;
  description: string;
}

export interface Logger {
  enable: boolean;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "panic";
  reportCaller: boolean;
}

export interface Mongo {
  name: string;
  url: string;
}

export interface PLMNID {
  mcc: string;
  mnc: string;
}

export interface SNSSAI {
  sst: number;
  sd?: string; // lowercase
}

export interface SBI {
  sbi?: SBI.Listener;
  serviceNameList?: string[];
  locality?: string;
  nrfCertPem?: string;
  nrfUri?: string;
}
export namespace SBI {
  export interface Listener {
    scheme: "https" | "http";
    registerIPv4: string;
    bindingIPv4: string;
    port?: number;
    tls?: unknown;
  }
}

export namespace amf {
  export interface Configuration extends SBI {
    amfName: string;
    ngapIpList: string[];
    ngapPort: number;
    servedGuamiList: GUAMI[];
    supportTaiList: TAI[];
    plmnSupportList: PLMN[];
    supportDnnList: string[];
  }

  export interface GUAMI {
    plmnId: PLMNID;
    amfId: string;
  }

  export interface TAI {
    plmnId: PLMNID;
    tac: string;
  }

  export interface PLMN {
    plmnId: PLMNID;
    snssaiList: SNSSAI[];
  }
}

export namespace ausf {
  export interface Configuration extends SBI {
    plmnSupportList: PLMNID[];
  }
}

export namespace chf {
  export interface Configuration extends SBI {
    chfName: string;
    mongodb: Mongo;
    cgf: CGF;
    abmfDiameter: Diameter<3868>;
    rfDiameter: Diameter<3869>;
  }

  export interface CGF {
    hostIPv4: string;
    port: 2122;
    listenPort: 2121;
    tls: unknown;
    cdrFilePath: unknown;
  }

  export interface Diameter<Port extends number> {
    protocol: "tcp";
    hostIPv4: string;
    port: Port;
    tls: unknown;
  }
}

export namespace nrf {
  export interface Configuration extends SBI {
    MongoDBName: string;
    MongoDBUrl: string;
    DefaultPlmnId: PLMNID;
  }
}

export namespace nssf {
  export interface Configuration extends SBI {
    nssfName: string;
    supportedPlmnList: PLMNID[];
    supportedNssaiInPlmnList: unknown[];
    nsiList: unknown[];
    amfSetList: unknown[];
    amfList: unknown[];
    taList: unknown[];
    mappingListFromPlmn: unknown[];
  }
}

export namespace pcf {
  export interface Configuration extends SBI {
    pcfName: string;
    mongodb: Mongo;
    defaultBdtRefId: string;
    serviceList: Service[];
  }

  export interface Service {
    serviceName: string;
    suppFeat?: number | string;
  }
}

export namespace smf {
  export interface Configuration extends SBI {
    smfName: string;
    pfcp: PFCP;
    userplaneInformation: UP;
    snssaiInfos: SNSSAIInfo[];
    plmnList: PLMNID[];
    urrPeriod?: number;
    urrThreshold?: number;
    nwInstFqdnEncoding?: boolean;
    [k: string]: unknown;
  }

  export interface PFCP {
    listenAddr: string;
    externalAddr: string;
    nodeID: string;
  }

  export interface UP {
    upNodes: Record<string, UPNode>;
    links: UPLink[];
  }

  export type UPNode = UPNodeAN | UPNodeUPF;

  export interface UPNodeAN {
    type: "AN";
    anIP?: string;
  }

  export interface UPNodeUPF {
    type: "UPF";
    nodeID: string;
    addr: string;
    sNssaiUpfInfos: UPFsnssai[];
    interfaces: UPFif[];
  }

  export interface UPFsnssai {
    sNssai: SNSSAI;
    dnnUpfInfoList: UPFdnn[];
  }

  export interface UPFdnn {
    dnn: string;
    pools: Array<{ cidr: string }>;
  }

  export interface UPFif {
    interfaceType: "N3" | "N9";
    endpoints: string[];
    networkInstances: string[];
  }

  export interface UPLink {
    A: string;
    B: string;
  }

  export interface SNSSAIInfo {
    sNssai: SNSSAI;
    dnnInfos: DNNInfo[];
  }

  export interface DNNInfo {
    dnn: string;
    dns: {
      ipv4: string;
    };
  }
}

export namespace udm {
  export interface Configuration extends SBI {
    SuciProfile: unknown;
  }
}

export namespace udr {
  export interface Configuration extends SBI {
    mongodb: Mongo;
  }
}

export namespace upf {
  export interface Root extends Info {
    logger: Logger;
    pfcp: PFCP;
    gtpu: GTPu;
    dnnList: DN[];
  }

  export interface PFCP {
    addr: string; // N4 IP or FQDN
    nodeID: string; // N4 IP or FQDN
    [k: string]: unknown;
  }

  export interface GTPu {
    forwarder: "gtp5g";
    ifList: GTPuIf[];
  }

  export interface GTPuIf {
    addr: string;
    type: "N3" | "N9";
    name?: string;
    ifname?: string;
    mtu?: number;
  }

  export interface DN {
    dnn: string;
    cidr: string;
    natifname?: string;
  }
}

export namespace webui {
  export interface Configuration extends SBI {
    mongodb: Mongo;
    webServer: WebServer;
    billingServer: BillingServer;
  }

  export interface WebServer {
    scheme: "http";
    ipv4Address: string;
    port: 5000;
  }

  export interface BillingServer {
    enable: boolean;
    hostIPv4: string;
    listenPort: 2122;
    port: 2121;
    tls: unknown;
  }
}
