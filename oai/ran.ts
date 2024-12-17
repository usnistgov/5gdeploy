import * as shlex from "shlex";

import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import * as UHD from "../srsran/uhd.js";
import type { ComposeService, OAI } from "../types/mod.js";
import { assert } from "../util/mod.js";
import * as oai_conf from "./conf.js";
import type { OAIOpts } from "./options.js";

/** Build RAN functions using OpenAirInterface5G. */
export async function oaiRAN(ctx: NetDefComposeContext, opts: OAIOpts): Promise<void> {
  for (const gnb of netdef.listGnbs(ctx.network)) {
    await makeGNB(ctx, opts, gnb);
  }

  if (opts["oai-gnb-usrp"]) {
    return;
  }
  for (const [ct, subscriber] of compose.suggestUENames(netdef.listSubscribers(ctx.network))) {
    await makeUE(ctx, opts, ct, subscriber);
  }
}

/** Define gNB container and generate configuration. */
async function makeGNB(ctx: NetDefComposeContext, opts: OAIOpts, gnb: netdef.GNB): Promise<void> {
  const nets = ["air", "mgmt", "n2", "n3"];
  if (opts["oai-gnb-usrp"]) {
    nets.shift();
  }
  const s = ctx.defineService(gnb.name, await oai_conf.getTaggedImageName(opts, "gnb"), nets);
  compose.annotate(s, "cpus", 4);
  s.privileged = true;

  const c = await oai_conf.loadLibconf<OAI.gnb.Config>(opts["oai-gnb-conf"], gnb.name);
  c.Active_gNBs = [gnb.name];

  assert(c.gNBs.length === 1);
  const g0 = c.gNBs[0]!;
  ({ gnb: g0.gNB_ID, nci: g0.nr_cellid } = gnb.nci);
  g0.gNB_name = gnb.name;
  g0.tracking_area_code = Number.parseInt(ctx.network.tac, 16);

  const { mcc, mnc } = netdef.splitPLMN(ctx.network.plmn);
  g0.plmn_list = [{
    mcc: Number.parseInt(mcc, 10),
    mnc: Number.parseInt(mnc, 10),
    mnc_length: mnc.length,
    snssaiList: Array.from(netdef.listNssai(ctx.network), (snssai): OAI.gnb.SNSSAI => netdef.splitSNSSAI(snssai).int),
    "snssaiList:dtype": "l",
  }];

  g0.amf_ip_address = Array.from(compose.listByNf(ctx.c, "amf"), (amf): OAI.gnb.AMF => ({
    ipv4: compose.getIP(amf, "n2"),
    ipv6: "100::",
    active: "yes",
    preference: "ipv4",
  }));
  g0.NETWORK_INTERFACES = {
    GNB_INTERFACE_NAME_FOR_NG_AMF: "n2",
    GNB_IPV4_ADDRESS_FOR_NG_AMF: compose.getIP(s, "n2"),
    GNB_INTERFACE_NAME_FOR_NGU: "n3",
    GNB_IPV4_ADDRESS_FOR_NGU: compose.getIP(s, "n3"),
    GNB_PORT_FOR_S1U: 2152,
  };

  c.rfsimulator = {
    serveraddr: "server",
  };

  c.telnetsrv = {
    listenaddr: compose.getIP(s, "mgmt"),
    listenport: 9090,
  };

  c.log_config = {
    global_log_level: "info",
    ngap_log_level: "debug",
  };

  delete c.e2_agent;

  const softmodemArgs = [
    "-O", "/opt/oai-gnb/etc/gnb.conf",
    "--sa",
    "--telnetsrv",
  ];

  if (opts["oai-gnb-usrp"]) {
    enableUSRP(opts["oai-gnb-usrp"], s, softmodemArgs);
  } else {
    softmodemArgs.push("-E", "--rfsim");
  }

  await ctx.writeFile(`ran-cfg/${gnb.name}.conf`, c, { s, target: "/opt/oai-gnb/etc/gnb.conf" });
  compose.setCommands(s, [
    ...compose.renameNetifs(s),
    "sleep 10",
    "msg Starting OpenAirInterface5G gNB",
    `exec /opt/oai-gnb/bin/nr-softmodem ${shlex.join(softmodemArgs)}`,
  ]);
}

function enableUSRP(usrp: OAIOpts["oai-gnb-usrp"], s: ComposeService, softmodemArgs: string[]): void {
  assert(usrp === "b2xx", `USRP ${usrp} is not supported`);
  softmodemArgs.push("-E", "--continuous-tx");
  UHD.prepareContainer(s, true);
}

/** Define UE container and generate configuration. */
async function makeUE(ctx: NetDefComposeContext, opts: OAIOpts, ct: string, sub: netdef.Subscriber): Promise<void> {
  const s = ctx.defineService(ct, await oai_conf.getTaggedImageName(opts, "ue"), ["mgmt", "air"]);
  compose.annotate(s, "cpus", 1);
  compose.annotate(s, "ue_supi", sub.supi);
  s.privileged = true;
  // As of v2.1.0, UE may transmit ICMPv6 router solicitation over PDU session. When this packet
  // reaches OAI-UPF-VPP, the UPF would reply with a malformed T-PDU, which then causes the gNB to
  // stop transmitting over the PDU session. Therefore, we disable IPv6 on newly created netifs to
  // prevent IPv6 traffic from appearing on the PDU session netif.
  s.sysctls["net.ipv6.conf.default.disable_ipv6"] = 1;

  const c = await oai_conf.loadLibconf<OAI.ue.Config>(opts["oai-ue-conf"], ct);
  c.uicc0 = {
    imsi: sub.supi,
    nmc_size: netdef.splitPLMN(ctx.network.plmn).mnc.length,
    key: sub.k,
    opc: sub.opc,
    dnn: "",
    nssai_sst: 0,
  };
  if (sub.requestedDN.length > 0) {
    const { snssai, dnn } = sub.requestedDN[0]!;
    const { sst, sd } = netdef.splitSNSSAI(snssai).int;
    c.uicc0.nssai_sst = sst;
    c.uicc0.nssai_sd = sd;
    c.uicc0.dnn = dnn;
  }

  c.rfsimulator = {
    serveraddr: compose.getIP(ctx.c, sub.gnbs[0]!, "air"),
  };

  c.telnetsrv = {
    listenaddr: compose.getIP(s, "mgmt"),
    listenport: 9090,
  };

  c.log_config = {
    global_log_level: "info",
  };

  await ctx.writeFile(`ran-cfg/${ct}.conf`, c, { s, target: "/opt/oai-nr-ue/etc/nr-ue.conf" });
  compose.setCommands(s, [
    ...compose.renameNetifs(s),
    "sleep 20",
    "msg Starting OpenAirInterface5G UE simulator",
    "exec /opt/oai-nr-ue/bin/entrypoint.sh /opt/oai-nr-ue/bin/nr-uesoftmodem" +
    " -E --sa --telnetsrv --rfsim -r 106 --numerology 1 -C 3619200000",
  ]);
}
