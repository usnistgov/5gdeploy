import { promises as fs } from "node:fs";
import path from "node:path";

import { Netmask } from "netmask";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

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
    depends_on: {} as Record<string, unknown>, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    image: "phoenix",
    command: `${CFGDIR}/start.sh ${ct} 1` as string | undefined,
    healthcheck: undefined as unknown,
    init: true,
    cap_add: [] as string[],
    devices: [] as string[],
    volumes: [] as unknown[],
    env_file: ["ip-export.env"],
    environment: {} as Record<string, string>, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    networks: {},
  };

  switch (ct) {
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
    case "btup":
    case "upf1":
    case "upf2": {
      service.cap_add.push("NET_ADMIN", "SYS_ADMIN");
      service.devices.push("/dev/net/tun:/dev/net/tun");
      break;
    }
    case "hostnat":
    case "igw":
    case "prometheus": {
      service.image = "alpine";
      service.command = "tail -f";
      break;
    }
  }

  if (service.image === "phoenix") {
    service.depends_on.sql = { condition: "service_healthy" };
    service.volumes.push({
      type: "bind",
      source: path.join(args.out, "cfg"),
      target: CFGDIR,
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
