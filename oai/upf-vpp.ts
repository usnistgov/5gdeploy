import path from "node:path";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { N } from "../types/mod.js";
import { assert, file_io } from "../util/mod.js";
import * as oai_conf from "./conf.js";
import type { OAIOpts } from "./options.js";

/** Build oai-upf-vpp UPF. */
export async function oaiUPvpp(ctx: NetDefComposeContext, upf: N.UPF, opts: OAIOpts): Promise<void> {
  const ct = upf.name;
  const { mcc, mnc } = NetDef.splitPLMN(ctx.network.plmn);

  const peers = ctx.netdef.gatherUPFPeers(upf);
  assert(peers.N6IPv4.length === 1, `UPF ${upf.name} must handle exactly 1 IPv4 DN`);
  const dn = peers.N6IPv4[0]!;
  const { sst, sd } = NetDef.splitSNSSAI(dn.snssai, true).ih;

  const image = await oai_conf.getTaggedImageName(opts, "upf-vpp");
  const s = ctx.defineService(ct, image, ["cp", "n4", "n6", "n3"]);
  compose.annotate(s, "cpus", opts["oai-upf-workers"]);
  s.privileged = true;
  s.command = ["/bin/bash", "/upf-vpp.sh"];
  await ctx.writeFile("oai-upf-vpp.sh", file_io.write.copyFrom(path.join(import.meta.dirname, "upf-vpp.sh")), {
    s, target: "/upf-vpp.sh",
  });
  Object.assign(s.environment, {
    NAME: ct,
    MCC: mcc,
    MNC: mnc,
    REALM: "3gppnetwork.org",
    VPP_MAIN_CORE: "0",
    VPP_CORE_WORKER: "1",
    VPP_PLUGIN_PATH: "/usr/lib/x86_64-linux-gnu/vpp_plugins/",
    REGISTER_NRF: "no",
    HTTP_VERSION: 2,
    IF_1_TYPE: "N4",
    IF_1_IP: compose.getIP(s, "n4"),
    IF_2_TYPE: "N6",
    IF_2_IP: compose.getIP(s, "n6"),
    IF_2_NWI: "core.oai.org",
    IF_3_TYPE: "N3",
    IF_3_IP: compose.getIP(s, "n3"),
    IF_3_NWI: "access.oai.org",
    SNSSAI_SST: sst,
    SNSSAI_SD: sd,
    DNN: dn.dnn,
  });

  if (opts["oai-cn5g-nrf"]) {
    ctx.finalize.push(() => {
      const { nrf } = ctx.c.services;
      assert(!!nrf);
      Object.assign(s.environment, {
        REGISTER_NRF: "yes",
        NRF_IP_ADDR: compose.getIP(nrf, "cp"),
        NRF_PORT: 8080,
      });
    });
  }
}
