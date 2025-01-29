import path from "node:path";

import stringify from "json-stringify-deterministic";
import map from "obliterator/map.js";
import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";

import { compose, http2Port, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, N } from "../types/mod.js";
import { assert, file_io, parseCpuset } from "../util/mod.js";
import { getTaggedImageName, makeDnaiFqdn, makeSUIL } from "./common.js";
import type { OAIOpts } from "./options.js";

/** Build oai-upf-vpp UPF. */
export async function oaiUPvpp(ctx: NetDefComposeContext, upf: N.UPF, opts: OAIOpts): Promise<void> {
  const ct = upf.name;

  const ve = new VppEnv(ctx.network, upf, opts);
  const image = await getTaggedImageName(opts, "upf-vpp");
  const s = ctx.defineService(ct, image, ve.nets);
  compose.annotate(s, "cpus", Math.max(2, opts["oai-upf-workers"]));
  s.privileged = true;
  const commandsEarly = [...compose.renameNetifs(s, { disableTxOffload: false })];
  const env: Env = {};
  ve.assignTo(s, env);

  ctx.finalize.push(async () => {
    const cpuset = s.cpuset ? parseCpuset(s.cpuset) : [0];
    env.VPP_MAIN_CORE = cpuset.at(-1)!;
    env.VPP_CORE_WORKER = cpuset[0]!;

    if (opts["oai-cn5g-nrf"]) {
      env.REGISTER_NRF = "yes";
      env.NRF_IP_ADDR = compose.getIP(ctx.c, "nrf", "cp");
      env.NRF_PORT = http2Port;
      env.HTTP_VERSION = 2;
    } else {
      env.REGISTER_NRF = "no";
    }

    await compose.setCommandsFile(ctx, s, [
      ...commandsEarly,
      ...map(Object.entries(env).toSorted(sortBy("0")), ([k, v]) => `export ${k}=${shlex.quote(`${v}`)}`),
      "msg Invoking entrypoint.sh",
      "/openair-upf/bin/entrypoint.sh true",
      await file_io.readText(path.join(import.meta.dirname, "upf-vpp.sh"), { once: true }),
    ], { filename: `up-cfg/${ct}.sh` });
  });
}

type Env = Record<string, string | number>;

interface VppIface {
  type: `N${4 | 6 | 3 | 9}`;
  intf: string;
  nwi?: string;
  dnai?: string;
}

class VppEnv {
  constructor(
      private readonly network: N.Network,
      private readonly upf: N.UPF,
      private readonly opts: OAIOpts,
  ) {
    this.plmn = netdef.splitPLMN(this.network.plmn);
    this.peers = netdef.gatherUPFPeers(network, upf);
    this.buildNetsIfaces();
  }

  private readonly plmn: netdef.PLMN;
  private readonly peers: netdef.UPFPeers;
  public readonly nets = ["cp", "n4"];
  public readonly ifaces: VppIface[] = [{ type: "N4", intf: "n4" }];

  private buildNetsIfaces(): void {
    const hasDnai = this.opts["oai-cn5g-dnai"];

    if (this.peers.N3.length > 0) {
      this.nets.push("n3");
      this.ifaces.push({
        type: "N3",
        intf: "n3",
        nwi: makeDnaiFqdn.access,
      });
    }

    assert(this.peers.N6Ethernet.length === 0, "oai-cn5g-upf-vpp does not support Ethernet DN");
    assert(this.peers.N6IPv6.length === 0, "oai-cn5g-upf-vpp does not support IPv6 DN");
    if (this.peers.N6IPv4.length > 0) {
      assert(this.peers.N6IPv4.length === 1, "oai-cn5g-upf-vpp supports at most 1 IPv4 DN");
      this.nets.push("n6");
      const [dnai, fqdn] = makeDnaiFqdn(this.peers.N6IPv4[0]!, this.plmn);
      this.ifaces.push({
        type: "N6",
        intf: "n6",
        nwi: hasDnai ? fqdn : makeDnaiFqdn.core,
        dnai,
      });
    }

    if (this.peers.N9.length > 0) {
      this.nets.push("n9");
      const [dnai, fqdn] = makeDnaiFqdn(this.peers.N9[0]!, this.plmn);
      this.ifaces.push({
        type: "N9",
        intf: "n9",
        nwi: fqdn,
        dnai,
      });
    }

    if (!hasDnai) {
      for (const iface of this.ifaces) {
        delete iface.dnai;
      }
    }
  }

  public assignTo(s: ComposeService, env: Env): void {
    const [dnai] = makeDnaiFqdn(this.upf, this.plmn);
    Object.assign(env, {
      NAME: dnai,
      MCC: this.plmn.mcc,
      MNC: this.plmn.mnc,
      REALM: makeDnaiFqdn.realm,
      VPP_PLUGIN_PATH: "/usr/lib/x86_64-linux-gnu/vpp_plugins/",
      PROFILE_SUIL: stringify(makeSUIL(
        this.network, this.peers, { sdFilled: true, withDnai: this.opts["oai-cn5g-dnai"] },
      )),
      SNSSAI_SST: 255, // overwritten by PROFILE_SUIL
      SNSSAI_SD: "000000", // overwritten by PROFILE_SUIL
      DNN: "default", // overwritten by PROFILE_SUIL
      PROFILE_IUIL: stringify(this.nets.includes("n9") ? this.makeIUIL(compose.getIP(s, "n9")) : []),
    });

    for (const [i, { intf, ...rest }] of this.ifaces.entries()) {
      const prefix = `IF_${1 + i}_`;
      env[`${prefix}IP`] = compose.getIP(s, intf);
      for (const [k, v] of Object.entries(rest)) {
        env[`${prefix}${k.toUpperCase()}`] = v;
      }
    }
  }

  private makeIUIL(n9ip: string): unknown {
    const list: unknown[] = [];
    for (const peer of this.peers.N9) {
      const [, fqdn] = makeDnaiFqdn(peer, this.plmn);
      list.push({
        interfaceType: "N9",
        ipv4EndpointAddresses: [n9ip],
        endpointFqdn: fqdn,
        networkInstance: fqdn,
      });
    }
    return list;
  }
}
