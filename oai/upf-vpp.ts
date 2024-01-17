import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import assert from "minimalistic-assert";

import { NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import { phoenixUP } from "../phoenix/mod.js";

const vppScript = await fs.readFile(fileURLToPath(new URL("upf-vpp.sh", import.meta.url)));

/**
 * Build UP functions using oai-upf-vpp as UPF.
 * Currently this can create association with Open5GCore SMF, but cannot pass traffic.
 */
export async function oaiUPvpp(ctx: NetDefComposeContext): Promise<void> {
  await phoenixUP(ctx);
  const [mcc, mnc] = NetDef.splitPLMN(ctx.network.plmn);
  await ctx.writeFile("oai-upf-vpp.sh", vppScript);

  for (const upf of ctx.network.upfs) {
    const s = ctx.c.services[upf.name];
    assert(!!s);
    await fs.unlink(path.resolve(ctx.out, `up-cfg/${upf.name}.json`));
    const phoenixVolumeIndex = s.volumes.findIndex((volume) => volume.target.startsWith("/opt/phoenix"));
    assert(phoenixVolumeIndex >= 0);
    s.volumes.splice(phoenixVolumeIndex, 1, {
      type: "bind",
      source: "./oai-upf-vpp.sh",
      target: "/upf-vpp.sh",
      read_only: true,
    });

    s.privileged = true;
    s.image = "oaisoftwarealliance/oai-upf-vpp:v1.5.1";
    s.command = ["/bin/bash", "/upf-vpp.sh"];
    Object.assign(s.environment, {
      NAME: s.hostname,
      MCC: mcc,
      MNC: mnc,
      REALM: "3gppnetwork.org",
      VPP_MAIN_CORE: "0",
      VPP_CORE_WORKER: "1",
      VPP_PLUGIN_PATH: "/usr/lib/x86_64-linux-gnu/vpp_plugins/",
      REGISTER_NRF: "no",
    });

    for (const [i, net] of ["n3", "n4", "n6", "n9"].entries()) {
      s.environment[`IF_${1 + i}_IP`] = s.networks[net]!.ipv4_address;
      s.environment[`IF_${1 + i}_TYPE`] = net.toUpperCase();
      s.environment[`IF_${1 + i}_NWI`] = `nwi${1 + i}.oai.org`;
    }

    for (const [peer] of ctx.netdef.listDataPathPeers(upf.name)) {
      if (typeof peer === "string") {
        continue;
      }
      const dn = ctx.netdef.findDN(peer);
      assert(!!dn);
      if (dn.type !== "IPv4") {
        continue;
      }

      assert(!s.environment.DNN, `UPF ${upf.name} must handle exactly 1 DN`);
      const { sst, sd = 0xFFFFFF } = NetDef.splitSNSSAI(dn.snssai).int;
      s.environment.SNSSAI_SST = sst.toString();
      s.environment.SNSSAI_SD = sd.toString();
      s.environment.DNN = dn.dnn;
    }
    assert(s.environment.DNN, `UPF ${upf.name} must handle exactly 1 DN`);
  }
}
