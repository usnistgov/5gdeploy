/** Compose file. */
export interface ComposeFile {
  networks: Record<string, ComposeNetwork>;
  services: Record<string, ComposeService>;
}

/** Compose network. */
export interface ComposeNetwork {
  name: string;
  driver_opts?: Record<string, string | number>;
  ipam: {
    driver: "default";
    config: Array<{ subnet: string }>;
  };
}

/** Compose service. */
export interface ComposeService {
  annotations?: Record<string, string>;
  container_name: string;
  hostname: string;
  image: string;
  entrypoint?: string[];
  command?: string[];
  init?: boolean;
  stdin_open?: boolean;
  tty?: boolean;
  stop_signal?: `SIG${string}`;
  privileged?: boolean;
  readonly cap_add: string[];
  readonly devices: string[];
  readonly sysctls: Record<string, string | number>;
  readonly volumes: ComposeVolume[];
  readonly environment: Record<string, string>;
  pid?: "host";
  network_mode?: "host" | "none" | `service:${string}`;
  readonly networks: Record<string, ComposeNetif>;
  readonly ports: ComposePort[];
  cpuset?: string;
}

/** Compose service bind volume. */
export interface ComposeVolume {
  type: "bind";
  source: string;
  target: string;
  read_only?: boolean;
}

/** Compose service network interface. */
export interface ComposeNetif {
  ipv4_address: string;
}

/** Compose service exposed port. */
export interface ComposePort {
  protocol: string;
  target: number;
  mode: "host";
  host_ip?: string;
  published: `${number}`;
}
