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
