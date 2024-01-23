import type { Info, Logger, PLMNID, Root } from "./free5gc";

export type { Root, Info, Logger, PLMNID };

export interface SNSSAI {
  sst: number;
  sd?: string;
}

export namespace gnbsim {
  export interface Configuration {
    gnbs: Record<string, GNB>;
    customProfiles: Record<string, unknown>;
    profiles: Profile[];
    singleInterface: boolean;
    execInParallel: boolean;
    httpServer: HTTPServer;
    goProfile: unknown;
    runConfigProfilesAtStart: boolean;
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
    taiSliceSupportList: SNSSAI[];
  }

  export interface AMF {
    hostName: string;
    ipAddr?: string;
    port: 38412;
  }

  export interface Profile {
    profileType: string;
    profileName: string;
    enable: boolean;
    gnbName: string;
    startImsi: string;
    ueCount: number;
    plmnId: PLMNID;
    dataPktCount?: number;
    dataPktInterval?: number;
    perUserTimeout?: number;
    defaultAs: string;
    key: string;
    opc: string;
    sequenceNumber: string;
    dnn: string;
    sNssai: SNSSAI;
    execInParallel: boolean;
    stepTrigger?: boolean;
    startIteration?: string;
    iterations?: unknown[];
  }

  export type ProfileType =
    "register" |
    "pdusessest" |
    "deregister" |
    "anrelease" |
    "uetriggservicereq" |
    "nwtriggeruedereg" |
    "uereqpdusessrelease" |
    "nwreqpdusessrelease" |
    "custom";

  export interface HTTPServer {
    enable: boolean;
    ipAddr: string;
    port: string;
  }
}
