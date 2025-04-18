import type { PartialDeep } from "type-fest";

import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { UERANSIM } from "../types/mod.js";
import { YargsGroup, type YargsInfer } from "../util/mod.js";

/** Yargs options definition for UERANSIM. */
export const ueransimOptions = YargsGroup("UERANSIM options:", {
  "ueransim-single-ue": {
    default: false,
    desc: "run a separate UERANSIM container for each UE",
    type: "boolean",
  },
});
export type UeransimOpts = YargsInfer<typeof ueransimOptions>;

export const ueransimDockerImage = "5gdeploy.localhost/ueransim";

/** Build RAN functions using UERANSIM. */
export function ueransimRAN(ctx: NetDefComposeContext, opts: UeransimOpts): void {
  new UeransimBuilder(ctx, opts).build();
}

class UeransimBuilder {
  constructor(private readonly ctx: NetDefComposeContext, private readonly opts: UeransimOpts) {
    this.plmn = netdef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: netdef.PLMN;

  public build(): void {
    for (const gnb of netdef.listGnbs(this.ctx.network)) {
      this.buildGNB(gnb);
    }

    const expandCount = this.opts["ueransim-single-ue"];
    for (const [ct, sub] of compose.suggestUENames(netdef.listSubscribers(this.ctx.network, { expandCount }))) {
      this.buildUE(ct, sub);
    }
  }

  private buildGNB(gnb: netdef.GNB): void {
    const s = this.ctx.defineService(gnb.name, ueransimDockerImage, ["air", "n2", "n3"]);
    compose.annotate(s, "cpus", 1);

    const c: PartialDeep<UERANSIM.gnb.Config> = {
      mcc: this.plmn.mcc,
      mnc: this.plmn.mnc,
      nci: Number.parseInt(gnb.nci, 16),
      idLength: this.ctx.network.gnbIdLength,
      tac: Number.parseInt(this.ctx.network.tac, 16),
      linkIp: compose.getIP(s, "air"),
      ngapIp: compose.getIP(s, "n2"),
      gtpIp: compose.getIP(s, "n3"),
      amfConfigs: Array.from(
        compose.listByNf(this.ctx.c, "amf"),
        (amf) => ({ address: compose.getIP(amf, "n2"), port: 38412 }),
      ),
      slices: Array.from(
        netdef.listNssai(this.ctx.network),
        (snssai) => netdef.splitSNSSAI(snssai).int,
      ),
    };

    compose.setCommands(s, [
      ...compose.waitNetifs(s, { disableTxOffload: true }),
      ...compose.applyQoS(s),
      "msg Preparing UERANSIM gNB config",
      ...compose.mergeConfigFile(c, {
        base: "/ueransim/config/custom-gnb.yaml",
        merged: `/ueransim/config/${gnb.name}.yaml`,
      }),
      "sleep 10",
      "msg Starting UERANSIM gNB",
      `exec /ueransim/nr-gnb -c /ueransim/config/${gnb.name}.yaml`,
    ]);
  }

  private buildUE(ct: string, sub: netdef.Subscriber): void {
    const s = this.ctx.defineService(ct, ueransimDockerImage, ["mgmt", "air"]);
    s.devices.push("/dev/net/tun:/dev/net/tun");
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
    compose.annotate(s, "cpus", 1);
    compose.annotate(s, "ue_supi", sub.supis.join(","));

    const nssai: UERANSIM.Slice[] = Array.from(
      sub.requestedNSSAI ?? sub.subscribedNSSAI,
      ({ snssai }) => netdef.splitSNSSAI(snssai).int,
    );
    const c: PartialDeep<UERANSIM.ue.Config> = {
      supi: `imsi-${sub.supi}`,
      mcc: this.plmn.mcc,
      mnc: this.plmn.mnc,
      key: sub.k,
      op: sub.opc,
      opType: "OPC",
      gnbSearchList: Array.from(sub.gnbs, (gnb) => compose.getIP(this.ctx.c, gnb, "air")),
      sessions: Array.from(
        sub.requestedDN,
        ({ dnn, snssai }) => ({
          type: "IPv4",
          apn: dnn,
          slice: netdef.splitSNSSAI(snssai).int,
        }),
      ),
      "configured-nssai": nssai,
      "default-nssai": nssai,
    };

    compose.setCommands(s, [
      ...compose.waitNetifs(s, { disableTxOffload: true }),
      "msg Preparing UERANSIM UE config",
      ...compose.mergeConfigFile(c, {
        base: "/ueransim/config/custom-ue.yaml",
        post: sub.count > 1 ? [`.supi line_comment="upto ${sub.supis.at(-1)!}"`] : [],
        merged: `/ueransim/config/${ct}.yaml`,
      }),
      "sleep 20",
      "msg Starting UERANSIM UE",
      `exec /ueransim/nr-ue -c /ueransim/config/${ct}.yaml -n ${sub.count}`,
    ]);
  }
}
