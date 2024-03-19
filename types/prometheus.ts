export interface Config {
  global: Global;
  scrape_configs: ScrapeConfig[];
  [k: string]: unknown;
}

export interface Global {
  scrape_interval?: `${number}s`;
  evaluation_interval?: `${number}s`;
  [k: string]: unknown;
}

export interface ScrapeConfig {
  job_name: string;
  metrics_path?: string;
  static_configs: StaticConfig[];
  metric_relabel_configs?: RelabelConfig[];
  [k: string]: unknown;
}

export interface StaticConfig {
  targets: string[];
  labels?: Record<string, string>;
}

export interface RelabelConfig {
  source_labels?: string[];
  regex?: string;
  target_label?: string;
  replacement?: string;
  [k: string]: unknown;
}

export namespace process_exporter {
  export interface Config {
    process_names: ProcessName[];
  }

  export interface ProcessName {
    name: string;
    comm: string[];
    cmdline: string[];
    [k: string]: unknown;
  }
}
