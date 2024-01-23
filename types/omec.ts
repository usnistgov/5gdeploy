import type { Info, Logger, PLMNID, Root } from "./free5gc";

export type { Root, Info, Logger, PLMNID };

export interface SNSSAI {
  sst: number;
  sd?: number;
}

export namespace gnbsim {
  export interface Configuration {
    singleInterface: boolean;
    execInParallel: boolean;
    httpServer: unknown;
    gnbs: Record<string, GNB>;
    customProfiles: Record<string, unknown>;
    profiles: unknown[];
  }

  export interface GNB {
    n2IpAddr: string;
    n2Port: 9487;
    n3IpAddr: string;
    n3Port: 2152;
    name: string;
    globalRanId: NCGI;
    supportedTaList: TA[];
    defaultAmf: AMF;
  }

  export interface NCGI {
    plmnId: PLMNID;
    gNbId: GNBID;
  }

  export interface GNBID {
    bitLength: number;
    gNBValue: string;
  }

  export interface TA {
    tac: string;
    broadcastPlmnList: BroadcastPLMN[];
  }

  export interface BroadcastPLMN {
    plmnId: PLMNID;
    taiSliceSupportedList: SNSSAI[];
  }

  export interface AMF {
    hostName: string;
    ipAddr?: string;
    port: 38412;
  }
}
