import { NetDef } from "../netdef/netdef.js";
import { IPMAP } from "../phoenix-config/mod.js";
import { type NetDefComposeContext } from "./context.js";

async function ueransim(ctx: NetDefComposeContext): Promise<void> {
  ctx.defineNetwork("air");

  for (const [ct, gnb] of IPMAP.suggestNames("gnb", ctx.network.gnbs)) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/ueransim", ["air", "n2", "n3"]);
    s.command = ["/entrypoint.sh", "gnb"];
    s.environment = {
      PLMN: ctx.network.plmn,
      NCI: gnb.nci,
      GNBIDLEN: ctx.network.gnbIdLength.toString(),
      TAC: ctx.network.tac,
      LINK_IP: s.networks.air!.ipv4_address,
      NGAP_IP: s.networks.n2!.ipv4_address,
      GTP_IP: s.networks.n3!.ipv4_address,
      AMF_IPS: ctx.gatherIPs("amf", "n2").join(","),
      SLICES: ctx.netdef.nssai.join(","),
    };
  }

  for (const [ct, subscriber] of IPMAP.suggestNames("ue", ctx.network.subscribers)) {
    const slices = new Set<string>();
    const sessions = new Set<string>();
    for (const { snssai, dnn } of ctx.netdef.listSubscriberDNs(subscriber, true)) {
      slices.add(snssai);
      sessions.add(`${dnn}:${snssai}`);
    }
    const s = ctx.defineService(ct, "5gdeploy.localhost/ueransim", ["air"]);
    s.command = ["/entrypoint.sh", "ue"];
    s.environment = {
      PLMN: ctx.network.plmn,
      IMSI: subscriber.supi,
      KEY: subscriber.k,
      OPC: subscriber.opc,
      GNB_IPS: ctx.gatherIPs(subscriber.gnbs ?? "gnb", "air").join(","),
      SLICES: [...slices].join(","),
      SESSIONS: [...sessions].join(","),
    };
    s.cap_add.push("NET_ADMIN");
    s.devices.push("/dev/net/tun:/dev/net/tun");
  }
}

async function oai(ctx: NetDefComposeContext): Promise<void> {
  const [mcc, mnc] = NetDef.splitPLMN(ctx.network.plmn);
  const sst = Number.parseInt(NetDef.splitSNSSAI(ctx.netdef.nssai[0]!)[0], 16);

  ctx.defineNetwork("air");

  for (const [ct, gnb] of IPMAP.suggestNames("gnb", ctx.network.gnbs)) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/oai-gnb", ["air", "n2", "n3"]);
    s.command = ["/entrypoint.sh", "gnb"];
    s.environment = {
      RFSIMULATOR: "server",
      USE_SA_TDD_MONO: "yes",
      SDR_ADDRS: "serial=XXXXXXX",
      USE_ADDITIONAL_OPTIONS: "--sa -E --rfsim --log_config.global_log_options level,nocolor,time",
      MCC: mcc,
      MNC: mnc,
      MNC_LENGTH: mnc.length.toString(),
      TAC: ctx.netdef.tac.toString(),
      GNB_NAME: gnb.name,
      NSSAI_SST: sst.toString(),
      AMF_IP_ADDRESS: ctx.gatherIPs("amf", "n2").join(","),
      GNB_NGA_IP_ADDRESS: s.networks.n2!.ipv4_address,
      GNB_NGU_IP_ADDRESS: s.networks.n3!.ipv4_address,
    };
    s.privileged = true;
  }

  for (const [ct, subscriber] of IPMAP.suggestNames("ue", ctx.network.subscribers)) {
    const dn = [...ctx.netdef.listSubscriberDNs(subscriber, true)][0]!;
    const s = ctx.defineService(ct, "5gdeploy.localhost/oai-nr-ue", ["air"]);
    s.command = ["/entrypoint.sh", "nr_ue"];
    s.environment = {
      RFSIMULATOR: ctx.gatherIPs("gnb", "air")[0]!,
      FULL_IMSI: subscriber.supi,
      FULL_KEY: subscriber.k,
      OPC: subscriber.opc,
      DNN: dn.dnn,
      NSSAI_SST: Number.parseInt(NetDef.splitSNSSAI(dn.snssai)[0], 16).toString(),
    };
    s.privileged = true;
  }
}

/** Topology generators for RAN services. */
export const RANProviders: Record<string, (ctx: NetDefComposeContext) => Promise<void>> = {
  ueransim,
  oai,
};
