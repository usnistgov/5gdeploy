import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Netmask } from "netmask";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const args = await yargs(hideBin(process.argv))
  .option("cfg", {
    demandOption: true,
    desc: "Open5GCore cfg directory",
    type: "string",
  })
  .option("out", {
    demandOption: true,
    desc: "Compose output directory",
    type: "string",
  })
  .parseAsync();

interface Compose {
  networks: Record<string, any>;
  services: Record<string, any>;
}

const compose: Compose = {
  networks: {},
  services: {},
};

function buildNetwork(net: string, ip: string, cidr: string) {
  const subnet4 = new Netmask(`${ip}/${cidr}`);
  return {
    driver_opts: {
      "com.docker.network.bridge.name": `br-${net}`,
      "com.docker.network.bridge.enable_ip_masquerade": 0,
    },
    ipam: {
      driver: "default",
      config: [{
        subnet: subnet4.toString(),
      }],
    },
  };
}

const CFGDIR = "/opt/phoenix/cfg/current";

function buildService(ct: string) {
  const service = {
    container_name: ct,
    hostname: ct,
    depends_on: {} as Record<string, unknown>, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    image: "phoenix",
    command: ["/bin/bash", "/entrypoint.sh"] as string[] | undefined,
    healthcheck: undefined as unknown,
    init: true,
    cap_add: [] as string[],
    devices: [] as string[],
    sysctls: {} as Record<string, unknown>, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    volumes: [] as unknown[],
    env_file: ["ip-export.env"],
    environment: {} as Record<string, string>, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    networks: {},
  };

  switch (ct.replace(/\d*$/, "")) {
    case "sql": {
      service.image = "bitnami/mariadb:10.9";
      service.command = undefined;
      service.healthcheck = {
        test: "mysql -u root -e 'USE smf_db; USE udm_db;'",
        interval: "30s",
        timeout: "5s",
        retries: 3,
        start_period: "30s",
      };
      service.volumes.push({
        type: "bind",
        source: path.join(args.out, "sql"),
        target: "/docker-entrypoint-startdb.d",
        read_only: true,
      });
      service.environment.ALLOW_EMPTY_PASSWORD = "yes";
      break;
    }
    case "gnb": {
      service.sysctls["net.ipv4.ip_forward"] = 0;
      break;
    }
    case "upf": {
      service.sysctls["net.ipv4.conf.all.accept_local"] = 1;
      service.sysctls["net.ipv4.conf.all.rp_filter"] = 2;
      service.sysctls["net.ipv4.conf.default.accept_local"] = 1;
      service.sysctls["net.ipv4.conf.default.rp_filter"] = 2;
      // fallthrough
    }
    case "btup": {
      service.cap_add.push("SYS_ADMIN");
      service.devices.push("/dev/net/tun:/dev/net/tun");
      break;
    }
    case "hostnat":
    case "igw":
    case "prometheus": {
      service.image = "alpine";
      service.command = ["/usr/bin/tail", "-f"];
      service.cap_add.push("NET_ADMIN");
      break;
    }
  }

  if (service.image === "phoenix") {
    service.depends_on.sql = { condition: "service_healthy" };
    service.cap_add.push("NET_ADMIN");
    service.sysctls["net.ipv4.ip_forward"] ??= 1;
    service.volumes.push({
      type: "bind",
      source: path.join(args.out, "cfg"),
      target: CFGDIR,
      read_only: true,
    }, {
      type: "bind",
      source: path.join(__dirname, "entrypoint.sh"),
      target: "/entrypoint.sh",
      read_only: true,
    });
    service.environment.cfgdir = CFGDIR;
  }
  return service;
}

function addNetwork({ networks }: { networks: Record<string, any> }, net: string, ip: string) {
  const network: { ipv4_address?: string } = {};
  if (ip !== "0.0.0.0") {
    network.ipv4_address = ip;
  }
  networks[net] = network;
}

for (let line of (await fs.readFile(path.join(args.cfg, "ip-map"), "utf8")).split("\n")) {
  line = line.trim();
  let tokens: [string, string, string, string];
  if (line.startsWith("#") || (tokens = line.split(/\s+/) as any).length !== 4) {
    continue;
  }
  const [ct, net, ip, cidr] = tokens;
  compose.networks[net] ??= buildNetwork(net, ip, cidr);
  compose.services[ct] ??= buildService(ct);
  addNetwork(compose.services[ct], net, ip);
}
await fs.writeFile(path.join(args.out, "compose.yml"), JSON.stringify(compose, undefined, 2));
