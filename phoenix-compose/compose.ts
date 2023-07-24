import * as compose from "../compose/mod.js";
import { IPMAP } from "../phoenix-config/mod.js";
import type { ComposeFile, ComposeService } from "../types/compose.js";

export const phoenixdir = "/opt/phoenix";
export const cfgdir = `${phoenixdir}/cfg/current`;
export const phoenixDockerImage = "5gdeploy.localhost/phoenix";

/** Convert ip-map to Compose file. */
export function convert(ipmap: IPMAP, deleteRAN = false): ComposeFile {
  const skipNf = ["prometheus"];
  if (deleteRAN) {
    skipNf.push("bt", "btup", "gnb", "ue");
  }

  const c = compose.create();
  for (const [net, subnet] of ipmap.networks) {
    compose.defineNetwork(c, net, subnet.toString(), net === "mgmt");
  }

  for (const [ct, nets] of ipmap.containers) {
    if (skipNf.includes(IPMAP.toNf(ct))) {
      continue;
    }
    const service = compose.defineService(c, ct, phoenixDockerImage);
    for (const [net, ip] of nets) {
      compose.connectNetif(c, ct, net, ip);
    }
    updateService(service);
  }

  return c;
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
