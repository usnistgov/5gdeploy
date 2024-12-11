export interface RootBase {
  logger: Logger;
  global: Global;
}

export interface Logger {
  path: {
    file: string;
  };
  level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
}

export interface Global {
  max: {
    ue: number;
    peer: number;
  };
}

export interface PLMNID {
  mcc: string;
  mnc: string;
}

export interface SNSSAI {
  sst: number;
  sd?: string;
}

export interface SBI {
  server: SBI.Server[];
  client: {
    nrf?: SBI.Client[];
    scp?: SBI.Client[];
  };
}
export namespace SBI {
  export interface Server {
    address: string;
    port?: number;
    dev?: string;
    advertise?: string;
  }

  export interface Client {
    uri: string;
  }
}

export interface Metrics {
  server: Metrics.Server[];
}
export namespace Metrics {
  export interface Server {
    dev: string;
    port: number;
  }
}

export interface PfcpServer {
  dev: string;
  advertise?: string;
}

export namespace amf {
  export interface Root extends RootBase {
    amf: AMF;
  }

  export interface AMF {
    sbi: SBI;
    ngap: NGAP;
    metrics: Metrics;
    guami: GUAMI[];
    tai: TAI[];
    plmn_support: PlmnSupport[];
    amf_name: string;
    [k: string]: unknown;
  }

  export interface NGAP {
    server: Array<{
      dev: string;
    }>;
  }

  export interface GUAMI {
    plmn_id: PLMNID;
    amf_id: {
      region: number;
      set: number;
    };
  }

  export interface TAI {
    plmn_id: PLMNID;
    tac: number;
  }

  export interface PlmnSupport {
    plmn_id: PLMNID;
    s_nssai: SNSSAI[];
  }
}

export namespace nrf {
  export interface Root extends RootBase {
    nrf: NRF;

    time: {
      nf_instance: {
        heartbeat: number; // seconds
      };
    };
  }

  export interface NRF {
    sbi: Pick<SBI, "server">;
    serving: Array<{
      plmn_id: PLMNID;
    }>;
  }
}

export namespace smf {
  export interface Root extends RootBase {
    smf: SMF;
  }

  export interface SMF {
    sbi: SBI;
    pfcp: {
      server: PfcpServer[];
      client: {
        upf: PfcpUpf[];
      };
    };
    gtpc: {
      server: Array<{
        dev: string;
      }>;
    };
    gtpu: {
      server: upf.GtpuServer[];
    };
    metrics: Metrics;
    session: upf.Session[];
    dns: string[];
    mtu: number;
    freeDiameter: string;
    [k: string]: unknown;
  }

  export interface PfcpUpf {
    address: string;
    dnn: string[];
  }
}

export namespace upf {
  export interface Root extends RootBase {
    upf: UPF;
  }

  export interface UPF {
    pfcp: {
      server: PfcpServer[];
    };
    gtpu: {
      server: GtpuServer[];
    };
    session: Session[];
    metrics: Metrics;
  }

  export interface GtpuServer {
    dev: string;
    [k: string]: unknown;
  }

  export interface Session {
    subnet: string;
    gateway?: string;
    dnn?: string;
    dev?: string;
  }
}
