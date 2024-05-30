import * as shlex from "shlex";
import assert from "tiny-invariant";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, OAI } from "../types/mod.js";
import * as oai_conf from "./conf.js";
import type { OAIOpts } from "./options.js";

/** Build RAN functions using OpenAirInterface5G. */
export async function oaiRAN(ctx: NetDefComposeContext, opts: OAIOpts): Promise<void> {
  for (const [ct, gnb] of compose.suggestNames("gnb", ctx.netdef.gnbs)) {
    await makeGNB(ctx, opts, ct, gnb);
  }

  if (opts["oai-gnb-usrp"]) {
    return;
  }
  for (const [ct, subscriber] of compose.suggestUENames(ctx.netdef.listSubscribers())) {
    await makeUE(ctx, opts, ct, subscriber);
  }
}

/** Define gNB container and generate configuration. */
async function makeGNB(ctx: NetDefComposeContext, opts: OAIOpts, ct: string, gnb: NetDef.GNB): Promise<void> {
  const nets = ["air", "mgmt", "n2", "n3"];
  if (opts["oai-gnb-usrp"]) {
    nets.shift();
  }
  const s = ctx.defineService(ct, await oai_conf.getTaggedImageName(opts, "gnb"), nets);
  compose.annotate(s, "cpus", 4);
  s.privileged = true;

  const c = await oai_conf.loadLibconf<OAI.gnb.Config>(opts["oai-gnb-conf"]);
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

  g0.amf_ip_address = ctx.gatherIPs("amf", "n2").map((ip): OAI.gnb.AMF => ({
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

  c.rfsimulator = {
    serveraddr: "server",
  };

  c.telnetsrv = {
    listenaddr: s.networks.mgmt!.ipv4_address,
    listenport: 9090,
  };

  c.log_config = {
    global_log_level: "info",
    ngap_log_level: "debug",
  };

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

  await ctx.writeFile(`ran-cfg/${ct}.conf`, c, { s, target: "/opt/oai-gnb/etc/gnb.conf" });
  compose.setCommands(s, [
    ...compose.renameNetifs(s),
    "sleep 10",
    "msg Starting OpenAirInterface5G gNB",
    `exec /opt/oai-gnb/bin/entrypoint.sh /opt/oai-gnb/bin/nr-softmodem ${shlex.join(softmodemArgs)}`,
  ]);
}

function enableUSRP(usrp: OAIOpts["oai-gnb-usrp"], s: ComposeService, softmodemArgs: string[]): void {
  assert(usrp === "b2xx", `USRP ${usrp} is not supported`);
  softmodemArgs.push("-E", "--continuous-tx");
  s.volumes.push({
    type: "bind",
    source: "/dev/bus/usb",
    target: "/dev/bus/usb",
  }, {
    type: "bind",
    source: "/usr/local/share/uhd/images",
    target: "/usr/local/share/uhd/images",
    read_only: true,
  });
}

/** Define UE container and generate configuration. */
async function makeUE(ctx: NetDefComposeContext, opts: OAIOpts, ct: string, sub: NetDef.Subscriber): Promise<void> {
  const s = ctx.defineService(ct, await oai_conf.getTaggedImageName(opts, "ue"), ["mgmt", "air"]);
  compose.annotate(s, "cpus", 1);
  compose.annotate(s, "ue_supi", sub.supi);
  s.privileged = true;

  const c = await oai_conf.loadLibconf<OAI.ue.Config>(opts["oai-ue-conf"]);
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
    const { sst, sd } = NetDef.splitSNSSAI(snssai).int;
    c.uicc0.nssai_sst = sst;
    c.uicc0.nssai_sd = sd;
    c.uicc0.dnn = dnn;
  }

  c.rfsimulator = {
    serveraddr: ctx.gatherIPs(sub.gnbs, "air")[0]!,
  };

  c.telnetsrv = {
    listenaddr: s.networks.mgmt!.ipv4_address,
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
    "exec /opt/oai-nr-ue/bin/entrypoint.sh /opt/oai-nr-ue/bin/nr-uesoftmodem -O /opt/oai-nr-ue/etc/nr-ue.conf" +
    " -E --sa --telnetsrv --rfsim -r 106 --numerology 1 -C 3619200000",
  ]);
}
