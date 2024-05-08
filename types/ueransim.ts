export interface Slice {
  sst: number;
  sd?: number;
}

export namespace gnb {
  export interface Config {
    mcc: string;
    mnc: string;
    nci: number;
    idLength: number;
    tac: number;
    linkIp: string;
    ngapIp: string;
    gtpIp: string;
    amfConfigs: AMF[];
    slices: Slice[];
    ignoreStreamIds: boolean;
  }

  export interface AMF {
    address: string;
    port: 38412;
  }
}

export namespace ue {
  export interface Config {
    supi: string;
    mcc: string;
    mnc: string;
    key: string;
    op: string;
    opType: "OP" | "OPC";
    gnbSearchList: string[];
    sessions: Session[];
    "configured-nssai"?: Slice[];
    "default-nssai"?: Slice[];
    [k: string]: unknown;
  }

  export interface Session {
    type: "IPv4";
    apn: string;
    slice: Slice;
  }
}

export type PSList = Record<string, PDUSession>;

export interface PDUSession {
  apn: string;
  address: string;
  [k: string]: unknown;
}
