import path from "node:path";

import type { Netmask } from "netmask";

import { __dirname, cfgdir, phoenixdir } from "./const.js";
import * as ipmap from "./ipmap.js";

interface ComposeFile {
  networks: Record<string, unknown>;
  services: Record<string, ComposeService>;
}

interface ComposeService {
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
  networks: Record<string, unknown>;
}

/** Convert ip-map to Compose file. */
export function convert(records: readonly ipmap.Record[]): ComposeFile {
  const c: ComposeFile = {
    networks: {},
    services: {},
  };

  for (const [net, subnet] of ipmap.listNetworks(records)) {
    c.networks[net] = buildNetwork(net, subnet);
  }

  for (const [ct, nets] of ipmap.listContainers(records)) {
    c.services[ct] = buildService(ct, nets);
  }

  return c;
}

function buildNetwork(net: string, subnet: Netmask) {
  const masquerade = Number(net === "mgmt");
  return {
    driver_opts: {
      "com.docker.network.bridge.name": `br-${net}`,
      "com.docker.network.bridge.enable_ip_masquerade": masquerade,
    },
    ipam: {
      driver: "default",
      config: [{
        subnet: subnet.toString(),
      }],
    },
  };
}

function buildService(ct: string, nets: ReadonlyMap<string, string>): ComposeService {
  const s: ComposeService = {
    container_name: ct,
    hostname: ct,
    image: "phoenix",
    init: true,
    cap_add: [],
    devices: [],
    sysctls: {},
    volumes: [],
    environment: {},
    networks: {},
  };

  for (const [net, ip] of nets) {
    s.networks[net] = { ipv4_address: ip };
  }

  const nf = ipmap.toNf(ct);
  updateService[nf]?.(s);
  if (s.image === "phoenix") {
    updatePhoenix(s);
  }

  return s;
}

const updateService: Record<string, (s: ComposeService) => void> = {
  sql(s) {
    s.image = "bitnami/mariadb:10.6";
    s.volumes.push({
      type: "bind",
      source: "./sql",
      target: "/docker-entrypoint-startdb.d",
      read_only: true,
    });
    s.environment.ALLOW_EMPTY_PASSWORD = "yes";
  },
  gnb(s) {
    s.sysctls["net.ipv4.ip_forward"] = 0;
  },
  upf(s) {
    const nNets = Object.entries(s.networks).length;
    for (let i = 0; i < nNets; ++i) {
      s.sysctls[`net.ipv4.conf.eth${i}.accept_local`] = 1;
      s.sysctls[`net.ipv4.conf.eth${i}.rp_filter`] = 2;
    }
    s.devices.push("/dev/net/tun:/dev/net/tun");
  },
  btup(s) {
    s.devices.push("/dev/net/tun:/dev/net/tun");
  },
  prometheus(s) {
    s.image = "alpine";
    s.command = ["/usr/bin/tail", "-f"];
  },
};

function updatePhoenix(s: ComposeService): void {
  s.command = ["/bin/bash", "/entrypoint.sh"];
  s.stdin_open = true;
  s.tty = true;
  s.cap_add.push("NET_ADMIN");
  s.sysctls["net.ipv4.ip_forward"] ??= 1;
  s.volumes.push({
    type: "bind",
    source: "./cfg",
    target: cfgdir,
    read_only: true,
  }, {
    type: "bind",
    source: path.join(__dirname, "entrypoint.sh"),
    target: "/entrypoint.sh",
    read_only: true,
  });
  Object.assign(s.environment, { phoenixdir, cfgdir });
}
