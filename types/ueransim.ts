export type PSList = Record<string, PDUSession>;

export interface PDUSession {
  apn: string;
  address: string;
  [k: string]: unknown;
}
