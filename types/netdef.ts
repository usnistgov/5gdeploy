/** 5G network definition. */
export interface Network {
  /** PLMN ID. */
  plmn: PLMN;

  /** gNB ID length in bits (22~32). */
  gnbIdLength: number;

  /** Tracking Area Code (24 bits, 6 hexadecimal digits). */
  tac: string;

  /** USIM cards. */
  subscribers: Subscriber[];

  /** gNodeBs. */
  gnbs: GNB[];

  /** UPFs. */
  upfs: UPF[];

  /** Data Networks. */
  dataNetworks: DataNetwork[];

  /** Data paths. */
  dataPaths: DataPaths;
}

/**
 * PLMN ID.
 * Example: "001-01", "001-001".
 */
export type PLMN = string;

/**
 * S-NSSAI, single network slice selection assistance information.
 * SST only: 2 hexadecimal digits, example: "01".
 * SST+SD: 8 hexadecimal digits, example: "80000001".
 * @see https://www.techplayon.com/5g-ran-and-5gc-network-slice-signaling/
 */
export type SNSSAI = string;

/**
 * Subscriber SIM card definition.
 * @see https://nickvsnetworking.com/hss-usim-authentication-in-lte-nr-4g-5g/
 */
export interface Subscriber {
  /** Subscriber identifier (15 decimal digits). */
  supi: string;

  /** USIM secret key (32 hexadecimal digits). */
  k: string;

  /** Operator secret key (32 hexadecimal digits). */
  opc: string;

  /** Subscribed S-NSSAIs and DNNs (stored in the UDM). */
  subscribedNSSAI?: SubscriberSNSSAI[];

  /** Configured/requested NSSAI and DNNs (requested by the UE). */
  requestedNSSAI?: SubscriberSNSSAI[];
}

/** Subscriber S-NSSAI and DNNs. */
export interface SubscriberSNSSAI {
  snssai: SNSSAI;
  dnns: string[];
}

/** gNodeB definition. */
export interface GNB {
  /** Short name. */
  name: string;

  /**
   * NR Cell Global Identifier (gNB ID + cell ID, 36 bits, 9 hexadecimal digits).
   * @see https://www.techplayon.com/5g-nr-cell-global-identity-planning/
   */
  ncgi: string;
}

/** User Plane Function (UPF) definition. */
export interface UPF {
  /** Short name. */
  name: string;
}

/** DN identifier. */
export interface DataNetworkID {
  /** Owning slice. */
  snssai: SNSSAI;

  /** DN name. */
  dnn: string;
}

/** Data Network (DN) definition. */
export interface DataNetwork extends DataNetworkID {
  /** DN type. */
  type: DataNetworkType;

  /**
   * IP subnet (CIDR format).
   * IPv4 example: 10.5.5.0/24
   */
  subnet?: string;
}

/** DN type. */
export type DataNetworkType = "IPv4" | "IPv6" | "Ethernet";

/** DN data paths. */
export interface DataPaths {
  links: DataPathLink[];
}

/**
 * Link in DN data path.
 *
 * Each end of a link may be either:
 * (1) a string that identifies the short name of a gNB or UPF.
 * (2) a DataNetworkID that identifies a DataNetwork.
 */
export type DataPathLink = DataPathLink.Tuple | DataPathLink.Object;
export namespace DataPathLink {
  /**
   * Two ends of a link.
   * Cost is the default.
   */
  export type Tuple = [
    a: string | DataNetworkID,
    b: string | DataNetworkID,
  ];

  export interface Object {
    /** One end of a link. */
    a: string | DataNetworkID;

    /** One end of a link. */
    b: string | DataNetworkID;

    /** Link cost (positive integer, default is 1). */
    cost?: number;
  }
}
