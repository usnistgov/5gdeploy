import assert from "minimalistic-assert";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { OAI } from "../types/mod.js";
import * as oai_conf from "./conf.js";

/** Build RAN functions using OpenAirInterface5G. */
export async function oaiRAN(ctx: NetDefComposeContext): Promise<void> {
  for (const [ct, gnb] of compose.suggestNames("gnb", ctx.netdef.gnbs)) {
    await makeGNB(ctx, ct, gnb);
  }

  for (const [ct, subscriber] of compose.suggestUENames(ctx.netdef.listSubscribers())) {
    await makeUE(ctx, ct, subscriber);
  }
}

/** Define gNB container and generate configuration */
async function makeGNB(ctx: NetDefComposeContext, ct: string, gnb: NetDef.GNB): Promise<void> {
  const s = ctx.defineService(ct, `oaisoftwarealliance/oai-gnb:${await oai_conf.getTag()}`, ["air", "n2", "n3"]);
  compose.annotate(s, "cpus", 1);
  s.privileged = true;

  const c = await oai_conf.loadTemplate<OAI.gnb.Config>("gnb.sa.band78.106prb.rfsim");
  c.Active_gNBs = [gnb.name];

  assert(c.gNBs.length === 1);
  const g0 = c.gNBs[0]!;
  ({ gnb: g0.gNB_ID, nci: g0.nr_cellid } = ctx.netdef.splitNCI(gnb.nci));
  g0.gNB_name = gnb.name;
  g0.tracking_area_code = ctx.netdef.tac;

  const { mcc, mnc } = NetDef.splitPLMN(ctx.network.plmn);
  g0.plmn_list = [{
    mcc: Number.parseInt(mcc, 10),
    mnc: Number.parseInt(mnc, 10),
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
    GNB_INTERFACE_NAME_FOR_NG_AMF: "n2",
    GNB_IPV4_ADDRESS_FOR_NG_AMF: s.networks.n2!.ipv4_address,
    GNB_INTERFACE_NAME_FOR_NGU: "n3",
    GNB_IPV4_ADDRESS_FOR_NGU: s.networks.n3!.ipv4_address,
    GNB_PORT_FOR_S1U: 2152,
  };

  c.log_config = {
    global_log_level: "info",
    ngap_log_level: "debug",
    nr_mac_log_level: "warn",
    phy_log_level: "warn",
  };

  await ctx.writeFile(`ran-cfg/${ct}.conf`, c, { s, target: "/opt/oai-gnb/etc/gnb.conf" });
  compose.setCommands(s, [
    ...compose.renameNetifs(s),
    "sleep 10",
    "exec /opt/oai-gnb/bin/entrypoint.sh /opt/oai-gnb/bin/nr-softmodem -O /opt/oai-gnb/etc/gnb.conf" +
    " --sa -E --rfsim",
  ]);
}

/** Define UE container and generate configuration. */
async function makeUE(ctx: NetDefComposeContext, ct: string, sub: NetDef.Subscriber): Promise<void> {
  const s = ctx.defineService(ct, `oaisoftwarealliance/oai-nr-ue:${await oai_conf.getTag()}`, ["air"]);
  compose.annotate(s, "cpus", 1);
  compose.annotate(s, "ue_supi", sub.supi);
  s.privileged = true;

  const c = await oai_conf.loadTemplate<OAI.ue.Config>("nrue.uicc");
  c.uicc0 = {
    imsi: sub.supi,
    nmc_size: NetDef.splitPLMN(ctx.network.plmn).mnc.length,
    key: sub.k,
    opc: sub.opc,
    dnn: "",
    nssai_sst: 0,
  };
  if (sub.requestedDN.length > 0) {
    const { snssai, dnn } = sub.requestedDN[0]!;
    c.uicc0.dnn = dnn;
    ({ sst: c.uicc0.nssai_sst, sd: c.uicc0.nssai_sd } = NetDef.splitSNSSAI(snssai).int);
  }

  c.rfsimulator = {
    serveraddr: ctx.gatherIPs(sub.gnbs, "air")[0]!,
  };

  c.log_config = {
    global_log_level: "info",
    ngap_log_level: "debug",
    nr_phy_log_level: "error",
    phy_log_level: "warn",
  };

  await ctx.writeFile(`ran-cfg/${ct}.conf`, c, { s, target: "/opt/oai-nr-ue/etc/nr-ue.conf" });
  compose.setCommands(s, [
    ...compose.renameNetifs(s),
    "sleep 20",
    "exec /opt/oai-nr-ue/bin/entrypoint.sh /opt/oai-nr-ue/bin/nr-uesoftmodem -O /opt/oai-nr-ue/etc/nr-ue.conf" +
    " -E --sa --rfsim -r 106 --numerology 1 -C 3619200000",
  ]);
}
