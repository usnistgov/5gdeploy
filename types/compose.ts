/** Compose file. */
export interface ComposeFile {
  volumes: Record<string, ComposeNamedVolume>;
  networks: Record<string, ComposeNetwork>;
  services: Record<string, ComposeService>;
}

/** Compose top-level volume. */
export interface ComposeNamedVolume {
  name: string;
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
  working_dir?: string;
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
  readonly extra_hosts: Record<string, string>;
  cpuset?: string;
  healthcheck?: ComposeHealthCheck;
  depends_on: Record<string, ComposeDependency>;
}

/** Compose service volume. */
export interface ComposeVolume {
  type: "bind" | "volume";
  source: string;
  target: string;
  read_only?: boolean;
  bind?: {
    create_host_path?: boolean;
  };
}

/** Compose service network interface. */
export interface ComposeNetif {
  mac_address: string;
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

/** Compose service healthcheck directive. */
export interface ComposeHealthCheck {
  test: ["CMD", ...string[]] | ["CMD-SHELL", string];
  interval?: string;
  timeout?: string;
  retries?: number;
  start_period?: string;
  start_interval?: string;
}

/** Compose service dependency. */
export interface ComposeDependency {
  condition: "service_started" | "service_healthy" | "service_completed_successfully";
}
