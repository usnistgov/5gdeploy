export interface Root {
  gnodeb: GNB;
  ue: UE;
  amfif: Array<If<38412>>;
  logs: {
    level: 0 | 1 | 2 | 3 | 4 | 5 | 6; // logrus level
  };
}

export interface GNB {
  controlif: If<9487>;
  dataif: If<2152>;
  plmnlist: {
    mcc: string;
    mnc: string;
    tac: string;
    gnbid: string;
  };
  slicesupportlist: {
    sst: string;
    sd: string;
  };
}

export interface UE {
  msin: string;
  key: string;
  opc: string;
  dnn: string;
  hplmn: {
    mcc: string;
    mnc: string;
  };
  snssai: {
    sst: number;
    sd: string;
  };
  [k: string]: unknown;
}

export interface If<Port extends number> {
  ip: string;
  port: Port;
}
