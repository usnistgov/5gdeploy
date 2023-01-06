import getStdin from "get-stdin";
import { Netmask } from "netmask";
import stdout from "stdout-stream";

interface Compose {
  networks: Record<string, any>;
  services: Record<string, any>;
}

const compose: Compose = {
  networks: {},
  services: {},
};

function buildNetwork(ip: string, cidr: string) {
  const net = new Netmask(`${ip}/${cidr}`);
  return {
    driver_opts: {
      "com.docker.network.bridge.enable_ip_masquerade": 0,
    },
    ipam: {
      driver: "default",
      config: [{
        subnet: net.toString(),
      }],
    },
  };
}

function buildService(ct: string) {
  const service = {
    container_name: ct,
    depends_on: {} as Record<string, unknown>, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    image: "phoenix",
    command: `/opt/phoenix/cfg/current/start.sh ${ct} 1` as string | undefined,
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
      service.image = "bitnami/mariadb:10.5";
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
        source: "/opt/phoenix-compose/sql",
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
      source: "/opt/phoenix-compose/cfg",
      target: "/opt/phoenix/cfg/current",
      read_only: true,
    });
    service.environment.cfgdir = "/opt/phoenix/cfg/current";
  }
  return service;
}

function addNetwork({ networks }: { networks: Record<string, any> }, net: string, ip: string) {
  networks[net] = ip === "0.0.0.0" ? {} : {
    ipv4_address: ip,
  };
}

for (let line of (await getStdin()).split("\n")) {
  line = line.trim();
  let tokens: [string, string, string, string];
  if (line.startsWith("#") || (tokens = line.split(/\s+/) as any).length !== 4) {
    continue;
  }
  const [ct, net, ip, cidr] = tokens;
  compose.networks[net] ??= buildNetwork(ip, cidr);
  compose.services[ct] ??= buildService(ct);
  addNetwork(compose.services[ct], net, ip);
}

stdout.write(`${JSON.stringify(compose, undefined, 2)}\n`);
