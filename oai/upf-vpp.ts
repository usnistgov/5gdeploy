import fs from "node:fs/promises";

import assert from "minimalistic-assert";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import * as NetDefDN from "../netdef-compose/dn.js";

const vppScript = await fs.readFile(new URL("upf-vpp.sh", import.meta.url));

/** Build UP functions using oai-upf-vpp as UPF. */
export async function oaiUPvpp(ctx: NetDefComposeContext): Promise<void> {
  NetDefDN.defineDNServices(ctx);
  const [mcc, mnc] = NetDef.splitPLMN(ctx.network.plmn);
  await ctx.writeFile("oai-upf-vpp.sh", vppScript);

  for (const [ct, upf] of compose.suggestNames("upf", ctx.network.upfs)) {
    const peers = ctx.netdef.gatherUPFPeers(upf);
    assert(peers.N6IPv4.length === 1, `UPF ${upf.name} must handle exactly 1 IPv4 DN`);
    const dn = peers.N6IPv4[0]!;
    const { sst, sd = "FFFFFF" } = NetDef.splitSNSSAI(dn.snssai).ih;

    const s = ctx.defineService(ct, "oaisoftwarealliance/oai-upf-vpp:v2.0.0", ["cp", "n4", "n6", "n3"]);
    compose.annotate(s, "cpus", 2);
    s.privileged = true;
    s.command = ["/bin/bash", "/upf-vpp.sh"];
    s.volumes.push({
      type: "bind",
      source: "./oai-upf-vpp.sh",
      target: "/upf-vpp.sh",
      read_only: true,
    });
    Object.assign(s.environment, {
      NAME: ct,
      MCC: mcc,
      MNC: mnc,
      REALM: "3gppnetwork.org",
      VPP_MAIN_CORE: "0",
      VPP_CORE_WORKER: "1",
      VPP_PLUGIN_PATH: "/usr/lib/x86_64-linux-gnu/vpp_plugins/",
      REGISTER_NRF: "yes",
      NRF_IP_ADDR: "nrf.br-cp",
      NRF_PORT: 8080,
      HTTP_VERSION: 2,
      IF_1_TYPE: "N4",
      IF_1_IP: s.networks.n4!.ipv4_address,
      IF_2_TYPE: "N6",
      IF_2_IP: s.networks.n6!.ipv4_address,
      IF_2_NWI: "internet.oai.org",
      IF_3_TYPE: "N3",
      IF_3_IP: s.networks.n3!.ipv4_address,
      IF_3_NWI: "access.oai.org",
      SNSSAI_SST: sst,
      SNSSAI_SD: sd,
      DNN: dn.dnn,
    });
  }

  NetDefDN.setDNCommands(ctx);
}
