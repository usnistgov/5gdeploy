export interface Root<Configuration extends {}> {
  info: Info;
  configuration: Configuration;
  logger: Logger;
}

export interface Info {
  version: "1.0.3";
  description: string;
}

export interface Logger {
  enable: boolean;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "panic";
  reportCaller: boolean;
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
