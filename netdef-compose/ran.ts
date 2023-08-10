import * as oai_netdef from "../oai-config/netdef.js";
import { IPMAP } from "../phoenix-config/mod.js";
import { type NetDefComposeContext } from "./context.js";

async function ueransim(ctx: NetDefComposeContext): Promise<void> {
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
  for (const [ct, gnb] of IPMAP.suggestNames("gnb", ctx.network.gnbs)) {
    await oai_netdef.makeGNB(ctx, ct, gnb);
  }

  for (const [ct, subscriber] of IPMAP.suggestNames("ue", ctx.network.subscribers)) {
    await oai_netdef.makeUE(ctx, ct, subscriber);
  }
}

/** Topology generators for RAN services. */
export const RANProviders: Record<string, (ctx: NetDefComposeContext) => Promise<void>> = {
  ueransim,
  oai,
};
