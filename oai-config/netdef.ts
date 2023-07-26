import assert from "minimalistic-assert";
import { collect, take } from "streaming-iterables";

import { NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import type * as N from "../types/netdef.js";
import type * as OAI from "../types/oai.js";
import * as oai_conf from "./conf.js";

const TAG = await oai_conf.getTag();

/** Define gNB container and generate configuration */
export async function makeGNB(ctx: NetDefComposeContext, ct: string, gnb: N.GNB): Promise<void> {
  const s = ctx.defineService(ct, `oaisoftwarealliance/oai-gnb:${TAG}`, ["air", "n2", "n3"]);

  const c = (await oai_conf.loadTemplate("gnb.sa.band78.106prb.rfsim")) as OAI.gnb.Config;
  c.Active_gNBs.splice(0, Infinity, gnb.name);

  assert(c.gNBs.length === 1);
  const g0 = c.gNBs[0]!;
  ({ gnb: g0.gNB_ID, nci: g0.nr_cellid } = ctx.netdef.splitNCI(gnb.nci));
  g0.gNB_name = gnb.name;
  g0.tracking_area_code = ctx.netdef.tac;

  const [mcc, mnc] = NetDef.splitPLMN(ctx.netdef.network.plmn);
  g0.plmn_list = [{
    mcc: Number.parseInt(mcc, 16),
    mnc: Number.parseInt(mnc, 16),
    mnc_length: mnc.length,
    snssaiList: ctx.netdef.nssai.map((snssai): OAI.gnb.SNSSAI => NetDef.splitSNSSAI(snssai).int),
    "snssaiList:dtype": "l",
  }];

  g0.amf_ip_address = ctx.gatherIPs("amf", "n2").slice(0, 1).map((ip): OAI.gnb.AMF => ({
    ipv4: ip,
    ipv6: "100::",
    active: "yes",
    preference: "ipv4",
  }));
  g0.NETWORK_INTERFACES = {
    GNB_INTERFACE_NAME_FOR_NG_AMF: "eth1",
    GNB_IPV4_ADDRESS_FOR_NG_AMF: s.networks.n2!.ipv4_address,
    GNB_INTERFACE_NAME_FOR_NGU: "eth2",
    GNB_IPV4_ADDRESS_FOR_NGU: s.networks.n3!.ipv4_address,
    GNB_PORT_FOR_S1U: 2152,
  };

  c.log_config = {
    global_log_level: "info",
    ngap_log_level: "debug",
    nr_mac_log_level: "warn",
    phy_log_level: "warn",
  };

  await ctx.writeFile(`ran-oai/${ct}.conf`, await oai_conf.save(c));

  s.privileged = true;
  s.environment = {
    USE_ADDITIONAL_OPTIONS: "--sa -E --rfsim",
  };
  s.volumes = [
    { type: "bind", source: `./ran-oai/${ct}.conf`, target: "/opt/oai-gnb/etc/gnb.conf", read_only: true },
  ];
}

/** Define UE container and generate configuration. */
export async function makeUE(ctx: NetDefComposeContext, ct: string, subscriber: N.Subscriber): Promise<void> {
  const s = ctx.defineService(ct, `oaisoftwarealliance/oai-nr-ue:${TAG}`, ["air"]);

  const c = (await oai_conf.loadTemplate("nrue.uicc")) as OAI.ue.Config;
  const [, mnc] = NetDef.splitPLMN(ctx.netdef.network.plmn);
  c.uicc0 = {
    imsi: subscriber.supi,
    nmc_size: mnc.length,
    key: subscriber.k,
    opc: subscriber.opc,
    dnn: "",
    nssai_sst: 0,
  };
  const [dn] = collect(take(1, ctx.netdef.listSubscriberDNs(subscriber, true)));
  if (dn) {
    c.uicc0.dnn = dn.dnn;
    ({ sst: c.uicc0.nssai_sst, sd: c.uicc0.nssai_sd } = NetDef.splitSNSSAI(dn.snssai).int);
  }

  c.rfsimulator = {
    serveraddr: ctx.gatherIPs("gnb", "air")[0]!,
  };

  c.log_config = {
    global_log_level: "info",
    ngap_log_level: "debug",
    nr_phy_log_level: "error",
    phy_log_level: "warn",
  };

  await ctx.writeFile(`ran-oai/${ct}.conf`, await oai_conf.save(c));

  s.privileged = true;
  s.environment = {
    USE_ADDITIONAL_OPTIONS: "-E --sa --rfsim -r 106 --numerology 1 -C 3619200000",
  };
  s.volumes = [
    { type: "bind", source: `./ran-oai/${ct}.conf`, target: "/opt/oai-nr-ue/etc/nr-ue.conf", read_only: true },
  ];
}
