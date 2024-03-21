export interface Config {
  process_names: ProcessName[];
}

export interface ProcessName {
  name: string;
  comm: string[];
  cmdline: string[];
  [k: string]: unknown;
}
