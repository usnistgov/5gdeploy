import path from "node:path";

import stringify from "json-stringify-deterministic";

import { compose, http2Port, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, N } from "../types/mod.js";
import { assert, file_io } from "../util/mod.js";
import { makeSUIL } from "./cn5g.js";
import { getTaggedImageName, makeUpfFqdn } from "./common.js";
import type { OAIOpts } from "./options.js";

/** Build oai-upf-vpp UPF. */
export async function oaiUPvpp(ctx: NetDefComposeContext, upf: N.UPF, opts: OAIOpts): Promise<void> {
  const ct = upf.name;

  const ve = new VppEnv(ctx.network, upf);
  const image = await getTaggedImageName(opts, "upf-vpp");
  const s = ctx.defineService(ct, image, ve.nets);
  compose.annotate(s, "cpus", opts["oai-upf-workers"]);
  s.privileged = true;
  s.command = ["/bin/bash", "/upf-vpp.sh"];
  await ctx.writeFile("oai-upf-vpp.sh", file_io.write.copyFrom(path.join(import.meta.dirname, "upf-vpp.sh")), {
    s, target: "/upf-vpp.sh",
  });
  ve.assignTo(s);

  if (opts["oai-cn5g-nrf"]) {
    ctx.finalize.push(() => {
      Object.assign(s.environment, {
        REGISTER_NRF: "yes",
        NRF_IP_ADDR: compose.getIP(ctx.c, "nrf", "cp"),
        NRF_PORT: `${http2Port}`,
      });
    });
  } else {
    s.environment.REGISTER_NRF = "no";
  }
}

interface VppIface {
  type: `N${4 | 6 | 3 | 9}`;
  intf: string;
  nwi?: string;
}

class VppEnv {
  constructor(private readonly network: N.Network, upf: N.UPF) {
    this.plmn = netdef.splitPLMN(this.network.plmn);
    this.peers = netdef.gatherUPFPeers(network, upf);
    if (this.peers.N3.length > 0) {
      this.nets.push("n3");
      this.ifaces.push({ type: "N3", intf: "n3", nwi: "access.oai.org" });
    }
    assert(this.peers.N6Ethernet.length === 0, "oai-cn5g-upf-vpp does not support Ethernet DN");
    assert(this.peers.N6IPv6.length === 0, "oai-cn5g-upf-vpp does not support IPv6 DN");
    if (this.peers.N6IPv4.length > 0) {
      assert(this.peers.N6IPv4.length === 1, "oai-cn5g-upf-vpp supports at most 1 IPv4 DN");
      this.nets.push("n6");
      this.ifaces.push({ type: "N6", intf: "n6", nwi: "core.oai.org" });
    }
    if (this.peers.N9.length > 0) {
      // TODO support multiple N9 peers through different Docker networks
      assert(this.peers.N9.length === 1, "oai-cn5g-upf-vpp supports at most 1 N9 peer");
      this.nets.push("n9");
      this.ifaces.push({ type: "N9", intf: "n9", nwi: makeUpfFqdn(this.peers.N9[0]!.name, this.plmn) });
    }
  }

  private readonly plmn: netdef.PLMN;
  private readonly peers: netdef.UPFPeers;
  public readonly nets = ["cp", "n4"];
  public readonly ifaces: VppIface[] = [{ type: "N4", intf: "n4" }];

  public assignTo(s: ComposeService): void {
    Object.assign(s.environment, {
      NAME: makeUpfFqdn.cleanName(s.container_name),
      MCC: this.plmn.mcc,
      MNC: this.plmn.mnc,
      REALM: makeUpfFqdn.realm,
      VPP_MAIN_CORE: "0",
      VPP_CORE_WORKER: "1",
      VPP_PLUGIN_PATH: "/usr/lib/x86_64-linux-gnu/vpp_plugins/",
      HTTP_VERSION: 2,
      PROFILE_SUIL: stringify(makeSUIL(this.network, this.peers, true)),
      SNSSAI_SST: 255, // overwritten by PROFILE_SUIL
      SNSSAI_SD: "000000", // overwritten by PROFILE_SUIL
      DNN: "default", // overwritten by PROFILE_SUIL
    });

    for (const [i, { type, intf, nwi }] of this.ifaces.entries()) {
      const prefix = `IF_${1 + i}_`;
      s.environment[`${prefix}TYPE`] = type;
      s.environment[`${prefix}IP`] = compose.getIP(s, intf);
      if (nwi) {
        s.environment[`${prefix}NWI`] = nwi;
      }
    }
  }
}
