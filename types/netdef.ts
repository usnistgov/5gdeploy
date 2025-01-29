/** 5G network definition. */
export interface Network {
  /** PLMN ID. */
  plmn: PLMN;

  /** gNB ID length in bits (22~32). */
  gnbIdLength: number;

  /** Tracking Area Code (24 bits, 6 hexadecimal digits). */
  tac: string;

  /** USIM default values. */
  subscriberDefault?: Pick<Subscriber, "k" | "opc">;

  /** USIM cards. */
  subscribers: Subscriber[];

  /** gNodeBs. */
  gnbs: GNB[];

  /** AMFs. */
  amfs?: AMF[];

  /** SMFs. */
  smfs?: SMF[];

  /** UPFs. */
  upfs: UPF[];

  /** Data Networks. */
  dataNetworks: DataNetwork[];

  /** Data paths. */
  dataPaths: DataPathLink[];
}

/**
 * PLMN ID.
 * Example: "001-01", "001-001".
 */
export type PLMN = string;

/**
 * S-NSSAI, single network slice selection assistance information.
 *
 * @remarks
 * SST only: 2 hexadecimal digits (upper case), example: "01".
 * SST+SD: 8 hexadecimal digits (upper case), example: "8000000F".
 * @see {@link https://www.techplayon.com/5g-ran-and-5gc-network-slice-signaling/}
 */
export type SNSSAI = string;

/**
 * Subscriber SIM card definition.
 * @see {@link https://nickvsnetworking.com/hss-usim-authentication-in-lte-nr-4g-5g/}
 */
export interface Subscriber {
  /** Subscriber identifier (15 decimal digits). */
  supi: string;

  /**
   * Repeat the subscriber with successive SUPI.
   * @defaultValue 1
   */
  count?: number;

  /**
   * USIM secret key (32 hexadecimal digits).
   * @defaultValue `.subscriberDefault.k ?? random`
   */
  k?: string;

  /**
   * Operator secret key (32 hexadecimal digits).
   * @defaultValue `.subscriberDefault.opc ?? random`
   */
  opc?: string;

  /**
   * Subscribed S-NSSAIs and DNNs (stored in the UDM).
   * @defaultValue all defined S-NSSAIs and DataNetworks
   */
  subscribedNSSAI?: SubscriberSNSSAI[];

  /** Configured/requested NSSAI and DNNs (requested by the UE). */
  requestedNSSAI?: SubscriberSNSSAI[];

  /**
   * Subscribed UE AMBR downlink, in Mbps.
   * @defaultValue 1000
   */
  dlAmbr?: number;

  /**
     * Subscribed UE AMBR uplink, in Mbps.
     * @defaultValue 1000
     */
  ulAmbr?: number;

  /**
   * Detected gNBs (short names).
   * @defaultValue all defined gNBs
   */
  gnbs?: string[];
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
   * NR Cell Identity (gNB ID + cell ID, 36 bits, 9 hexadecimal digits).
   * @defaultValue sequentially assigned `[1+i,0xF]`
   * @see {@link https://www.techplayon.com/5g-nr-cell-global-identity-planning/}
   */
  nci?: string;
}

/** User Plane Function (UPF) definition. */
export interface UPF {
  /** Short name. */
  name: string;
}

/** Access and Mobility Management Function (AMF) definition. */
export interface AMF {
  /**
   * Short name.
   * @defaultValue sequentially assigned "amfI"
   */
  name?: string;

  /**
   * AMF Identifier.
   * @defaultValue sequentially assigned `[1, i, 0]`
   */
  amfi?: AMFI;

  /**
   * Served S-NSSAIs.
   * @defaultValue all S-NSSAIs defined in DataNetworks
   */
  nssai?: SNSSAI[];
}

/** Session Management Function (SMF) definition. */
export interface SMF {
  /**
   * Short name.
   * @defaultValue sequentially assigned "smfI"
   */
  name?: string;

  /**
   * Served S-NSSAIs.
   * @defaultValue all S-NSSAIs defined in DataNetworks
   */
  nssai?: SNSSAI[];
}

/**
 * AMF Identifier.
 *
 * @remarks
 * - AMF Region ID: 8 bits.
 * - AMF Set ID: 10 bits.
 * - AMF Pointer: 6 bits.
 */
export type AMFI = [region: number, set: number, pointer: number];

/** DN identifier. */
export interface DataNetworkID {
  /** Owning slice. */
  snssai: SNSSAI;

  /** DN name. */
  dnn: string;
}

/** Data Network (DN) definition. */
/* eslint-disable tsdoc/syntax -- @minimum and @maximum are used by ts-json-schema-generator */
export interface DataNetwork extends DataNetworkID {
  /** DN type. */
  type: DataNetworkType;

  /**
   * IP subnet (CIDR format).
   *
   * @remarks
   * IPv4 example: `10.5.5.0/24`
   */
  subnet?: string;

  /**
   * 5G QoS Identifier (5QI).
   * @defaultValue 9
   * @minimum 1
   */
  fiveQi?: number;

  /**
   * 5QI priority level.
   * @defaultValue 90
   * @minimum 1
   * @maximum 127
   */
  fiveQiPriorityLevel?: number;

  /**
   * Allocation/Retention Priority (ARP) level.
   * @defaultValue 8
   * @minimum 1
   * @maximum 15
   */
  arpLevel?: number;

  /**
   * Session AMBR downlink, in Mbps.
   * @defaultValue 1000
   */
  dlAmbr?: number;

  /**
   * Session AMBR uplink, in Mbps.
   * @defaultValue 1000
   */
  ulAmbr?: number;
}
/* eslint-enable tsdoc/syntax */

/** DN type. */
export type DataNetworkType = "IPv4" | "IPv6" | "Ethernet";

/** DN data path node. */
export type DataPathNode = string | DataNetworkID;

/**
 * Link in DN data path.
 *
 * @remarks
 * Each end of a link may be either:
 * (1) a string that identifies the short name of a gNB or UPF.
 * (2) a DataNetworkID that identifies a DataNetwork.
 */
export type DataPathLink = [a: DataPathNode, b: DataPathNode] | [a: DataPathNode, b: DataPathNode, cost: number];
// note: writing as two alternate types is needed for ts-json-schema-generator to allow 2-item array
