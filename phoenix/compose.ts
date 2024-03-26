import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/mod.js";

const phoenixdir = "/opt/phoenix";
const cfgdir = `${phoenixdir}/cfg/current`;
export const phoenixDockerImage = "5gdeploy.localhost/phoenix";

/** Per-network options. */
export const networkOptions: Record<string, compose.defineNetwork.Options> = {
  mgmt: { wantNAT: true },
  air: { mtu: 1470 },
  n6: { mtu: 1456 },
};

/** Update Composer service properties to match Open5GCore expectation. */
export function updateService(s: ComposeService, opts: updateService.Options = {}): void {
  const nf = compose.nameToNf(s.container_name);
  updateNf[nf]?.(s, opts);
  if (s.image === phoenixDockerImage) {
    updatePhoenix(s, opts);
  }
}
export namespace updateService {
  export interface Options {
    /**
     * Output configuration directory.
     * @defaultValue "./cfg"
     */
    cfg?: string;

    /**
     * Output SQL script directory.
     * @defaultValue "./sql"
     */
    sql?: string;
  }
}

const updateNf: Record<string, (s: ComposeService, opts: updateService.Options) => void> = {
  sql(s, { sql = "./sql" }) {
    s.image = compose.mysql.image;
    compose.mysql.init(s, sql);
  },
  gnb(s) {
    s.sysctls["net.ipv4.ip_forward"] = 0;
  },
  upf(s) {
    for (const netif of ["all", "default"]) {
      s.sysctls[`net.ipv4.conf.${netif}.accept_local`] = 1;
      s.sysctls[`net.ipv4.conf.${netif}.rp_filter`] = 2;
    }
    s.devices.push("/dev/net/tun:/dev/net/tun");
  },
  btup(s) {
    s.devices.push("/dev/net/tun:/dev/net/tun");
  },
};

function updatePhoenix(s: ComposeService, { cfg = "./cfg" }: updateService.Options): void {
  s.command = ["/entrypoint.sh", s.container_name];
  s.stdin_open = true;
  s.tty = true;
  s.cap_add.push("NET_ADMIN");
  s.sysctls["net.ipv4.ip_forward"] ??= 1;
  s.sysctls["net.ipv6.conf.all.disable_ipv6"] ??= 1;
  s.volumes.push({
    type: "bind",
    source: cfg,
    target: cfgdir,
    read_only: true,
  });
  Object.assign(s.environment, { phoenixdir, cfgdir });
}
