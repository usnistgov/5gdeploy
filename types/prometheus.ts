export interface Config {
  scrape_configs: ScrapeConfig[];
  [k: string]: unknown;
}

export interface ScrapeConfig {
  job_name: string;
  metrics_path: string;
  static_configs: StaticConfig[];
  [k: string]: unknown;
}

export interface StaticConfig {
  targets: string[];
  labels: Record<string, string>;
}
