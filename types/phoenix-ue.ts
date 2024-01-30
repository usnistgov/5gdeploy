export enum MMState {
  MM_NULL = 0,
  MM_DEREGISTERED = 1,
  MM_REGISTERED_INITIATED = 2,
  MM_REGISTERED = 3,
  MM_DEREGISTERED_INITIATED = 4,
  MM_SERVICE_REQUEST_INITIATED = 5,
}

export enum CMState {
  CM_IDLE = 6,
  CM_CONNECTED = 7,
}

export enum SMState {
  PDU_SESSION_INACTIVE = 8,
  PDU_SESSION_ACTIVE_PENDING = 9,
  PDU_SESSION_ACTIVE = 10,
  PDU_SESSION_INACTIVE_PENDING = 11,
  PDU_SESSION_MODIFICATION_PENDING = 12,
  PROCEDURE_TRANSACTION_INACTIVE = 13,
  PROCEDURE_TRANSACTION_PENDING = 14,
}

export interface Status {
  supi: string;
  access_3gpp: Access;
  access_non3gpp: Access;
  pdu: Record<string, PDUSession>;
  [k: string]: unknown;
}

export interface Access {
  mm_state: MMState;
  cm_state: CMState;
  [k: string]: unknown;
}

export interface PDUSession {
  id: number;
  sm_state: SMState;
  ipv4?: string;
  [k: string]: unknown;
}
