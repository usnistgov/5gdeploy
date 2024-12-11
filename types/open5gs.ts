import type { Except, RequireAtLeastOne } from "type-fest";

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

export type SockNode = RequireAtLeastOne<{
  family?: 0 | 2 | 10;
  address?: string;
  port?: number;
  dev?: string;
  option?: unknown;
}, "address" | "dev">;
export namespace SockNode {
  export type WithAdvertise = SockNode & {
    advertise?: string;
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
  server: SockNode.WithAdvertise[];
  client: {
    nrf?: SBI.Client[];
    scp?: SBI.Client[];
  };
}
export namespace SBI {
  export interface Client {
    uri: string;
  }
}

export interface Metrics {
  server: SockNode[];
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
    server: SockNode[];
  }

  export interface GUAMI {
    plmn_id: PLMNID;
    amf_id: {
      region: number;
      set: number;
      pointer?: number;
    };
  }

  export interface TAI {
    plmn_id: PLMNID;
    tac: number[];
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
    info: Info[];
    sbi: SBI;
    pfcp: {
      server: SockNode.WithAdvertise[];
      client: {
        upf: PfcpUpf[];
      };
    };
    gtpu: {
      server: SockNode[];
    };
    metrics: Metrics;
    session: Session[];
    dns: string[];
    mtu: number;
    [k: string]: unknown;
  }

  export interface Info {
    s_nssai: Array<SNSSAI & { dnn: string[] }>;
    tai?: unknown;
  }

  export interface PfcpUpf {
    address: string;
    dnn: string[];
  }

  export type Session = Except<upf.Session, "dev">;
}

export namespace upf {
  export interface Root extends RootBase {
    upf: UPF;
  }

  export interface UPF {
    pfcp: {
      server: SockNode.WithAdvertise[];
    };
    gtpu: {
      server: SockNode[];
    };
    session: Session[];
    metrics: Metrics;
  }

  export interface Session {
    subnet: string;
    gateway?: string;
    dnn?: string;
    dev?: string;
  }
}
