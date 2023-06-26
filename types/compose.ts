/** Docker Compose file. */
export interface ComposeFile {
  networks: Record<string, unknown>;
  services: Record<string, ComposeService>;
}

/** Docker Compose service. */
export interface ComposeService {
  container_name: string;
  hostname: string;
  image: string;
  command?: string[];
  init?: boolean;
  stdin_open?: boolean;
  tty?: boolean;
  cap_add: string[];
  devices: string[];
  sysctls: Record<string, string | number>;
  volumes: unknown[];
  environment: Record<string, string>;
  network_mode?: string;
  networks: Record<string, unknown>;
}
