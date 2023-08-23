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
  container_name: string;
  hostname: string;
  image: string;
  entrypoint?: string[];
  command?: string[];
  init?: boolean;
  stdin_open?: boolean;
  tty?: boolean;
  privileged?: boolean;
  cap_add: string[];
  devices: string[];
  sysctls: Record<string, string | number>;
  volumes: ComposeVolume[];
  environment: Record<string, string>;
  network_mode?: string;
  networks: Record<string, ComposeNetif>;
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
