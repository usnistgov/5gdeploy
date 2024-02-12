import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";

/** Build RAN functions using UERANSIM. */
export async function ueransimRAN(ctx: NetDefComposeContext): Promise<void> {
  for (const [ct, gnb] of compose.suggestNames("gnb", ctx.netdef.gnbs)) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/ueransim", ["air", "n2", "n3"]);
    compose.setCommands(s, [
      ...compose.renameNetifs(s, { pipeworkWait: true }),
      "/entrypoint.sh gnb",
    ]);
    Object.assign(s.environment, {
      PLMN: ctx.network.plmn,
      NCI: gnb.nci,
      GNBIDLEN: ctx.network.gnbIdLength.toString(),
      TAC: ctx.network.tac,
      LINK_IP: s.networks.air!.ipv4_address,
      NGAP_IP: s.networks.n2!.ipv4_address,
      GTP_IP: s.networks.n3!.ipv4_address,
      AMF_IPS: ctx.gatherIPs("amf", "n2").join(","),
      SLICES: ctx.netdef.nssai.join(","),
    });
    s.cap_add.push("NET_ADMIN");
  }

  for (const [ct, sub] of compose.suggestUENames(ctx.netdef.listSubscribers({ expandCount: false }))) {
    const slices = new Set<string>();
    const sessions = new Set<string>();
    for (const { snssai, dnn } of sub.requestedDN) {
      slices.add(snssai);
      sessions.add(`${dnn}:${snssai}`);
    }
    const s = ctx.defineService(ct, "5gdeploy.localhost/ueransim", ["air"]);
    compose.annotate(s, "ue_supi", NetDef.listSUPIs(sub).join(","));
    s.command = ["/entrypoint.sh", "ue"];
    Object.assign(s.environment, {
      PLMN: ctx.network.plmn,
      IMSI: sub.supi,
      COUNT: sub.count.toString(),
      KEY: sub.k,
      OPC: sub.opc,
      GNB_IPS: ctx.gatherIPs(sub.gnbs, "air").join(","),
      SLICES: [...slices].join(","),
      SESSIONS: [...sessions].join(","),
    });
    s.cap_add.push("NET_ADMIN");
    s.devices.push("/dev/net/tun:/dev/net/tun");
  }
}
