import assert from "minimalistic-assert";
import type { Netmask } from "netmask";

import type { NetDef } from "../netdef/netdef.js";
import { IPMAP } from "../phoenix-config/mod.js";
import type { ComposeFile, ComposeNetwork, ComposeService } from "../types/compose.js";
import { type RANServiceGenContext, RANServiceGens } from "./ran.js";

export const phoenixdir = "/opt/phoenix";
export const cfgdir = `${phoenixdir}/cfg/current`;
export const phoenixDockerImage = "5gdeploy.localhost/phoenix";

/** Convert ip-map to Compose file. */
export function convert(ipmap: IPMAP, deleteRAN = false): ComposeFile {
  const skipNf = ["prometheus"];
  if (deleteRAN) {
    skipNf.push("bt", "btup", "gnb", "ue");
  }

  const c: ComposeFile = {
    networks: {},
    services: {},
  };

  for (const [net, subnet] of ipmap.networks) {
    c.networks[net] = buildNetwork(net, subnet);
  }

  for (const [ct, nets] of ipmap.containers) {
    if (skipNf.includes(IPMAP.toNf(ct))) {
      continue;
    }
    c.services[ct] = buildService(ct, nets);
  }

  return c;
}

function buildNetwork(net: string, subnet: Netmask): ComposeNetwork {
  const masquerade = Number(net === "mgmt");
  return {
    name: `br-${net}`,
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
    image: phoenixDockerImage,
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

  updateService(s);
  return s;
}

export function updateService(s: ComposeService): void {
  const nf = IPMAP.toNf(s.container_name);
  updateNf[nf]?.(s);
  if (s.image === phoenixDockerImage) {
    updatePhoenix(s);
  }
}

const updateNf: Record<string, (s: ComposeService) => void> = {
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
};

function updatePhoenix(s: ComposeService): void {
  s.command = ["/entrypoint.sh", s.hostname];
  s.stdin_open = true;
  s.tty = true;
  s.cap_add.push("NET_ADMIN");
  s.sysctls["net.ipv4.ip_forward"] ??= 1;
  s.volumes.push({
    type: "bind",
    source: "./cfg",
    target: cfgdir,
    read_only: true,
  });
  Object.assign(s.environment, { phoenixdir, cfgdir });
}

export function mergeRAN(compose: ComposeFile, ranCompose: ComposeFile, ipmap: IPMAP, netdef: NetDef): void {
  const { gnb: gnbTpl, ue: ueTpl } = ranCompose.services;
  assert(!!gnbTpl, "missing 'gnb' container");
  assert(!!ueTpl, "missing 'ue' container");

  const { network } = netdef;
  const ctx: RANServiceGenContext = {
    netdef,
    network,
    compose,
  };

  scaleRAN(ctx, ipmap, gnbTpl, network.gnbs);
  scaleRAN(ctx, ipmap, ueTpl, network.subscribers);
}

function scaleRAN<T>(ctx: RANServiceGenContext, ipmap: IPMAP, tpl: ComposeService, items: readonly T[]): void {
  const nf = tpl.container_name as "gnb" | "ue";
  const netifs = Object.keys(tpl.networks);
  const containers = IPMAP.suggestNames(nf, items);
  ipmap.scaleContainers([...containers.keys()], netifs);
  for (const [ct, item] of containers) {
    const s = JSON.parse(JSON.stringify(tpl)) as ComposeService;
    s.container_name = ct;
    s.hostname = ct;
    s.networks = {};
    for (const [net, ip] of ipmap.containers.get(ct)!) {
      s.networks[net] = { ipv4_address: ip };
    }
    ctx.compose.services[ct] = s;
    RANServiceGens[s.image.replace("5gdeploy.localhost/", "")]?.[nf]?.(ctx, item as any, s);
  }
}
