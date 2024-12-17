import type { PartialDeep } from "type-fest";

import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { UERANSIM } from "../types/mod.js";
import type { YargsInfer, YargsOptions } from "../util/mod.js";

/** Yargs options definition for UERANSIM. */
export const ueransimOptions = {
  "ueransim-single-ue": {
    default: false,
    desc: "run a separate UERANSIM container for each UE",
    group: "ueransim",
    type: "boolean",
  },
} as const satisfies YargsOptions;
export type UeransimOpts = YargsInfer<typeof ueransimOptions>;

export const ueransimDockerImage = "5gdeploy.localhost/ueransim";

/** Build RAN functions using UERANSIM. */
export async function ueransimRAN(ctx: NetDefComposeContext, opts: UeransimOpts): Promise<void> {
  await new UeransimBuilder(ctx, opts).build();
}

class UeransimBuilder {
  constructor(private readonly ctx: NetDefComposeContext, private readonly opts: UeransimOpts) {
    this.plmn = netdef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: netdef.PLMN;

  public async build(): Promise<void> {
    for (const gnb of netdef.listGnbs(this.ctx.network)) {
      await this.buildGNB(gnb);
    }

    const expandCount = this.opts["ueransim-single-ue"];
    for (const [ct, sub] of compose.suggestUENames(netdef.listSubscribers(this.ctx.network, { expandCount }))) {
      await this.buildUE(ct, sub);
    }
  }

  private async buildGNB(gnb: netdef.GNB): Promise<void> {
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
        (amf) => ({ address: compose.getIP(amf, "n2"), port: 38412 } as const),
      ),
      slices: Array.from(
        netdef.listNssai(this.ctx.network),
        (snssai) => netdef.splitSNSSAI(snssai).int,
      ),
    };
    await this.ctx.writeFile(`ran-cfg/${gnb.name}.yaml`, c, { s, target: "/ueransim/config/update.yaml" });

    compose.setCommands(s, [
      ...compose.renameNetifs(s, { disableTxOffload: true }),
      ...compose.applyQoS(s),
      "msg Preparing UERANSIM gNB config",
      ...compose.mergeConfigFile("/ueransim/config/update.yaml", {
        base: "/ueransim/config/custom-gnb.yaml",
        merged: `/ueransim/config/${gnb.name}.yaml`,
      }),
      "sleep 10",
      "msg Starting UERANSIM gNB",
      `exec /ueransim/nr-gnb -c /ueransim/config/${gnb.name}.yaml`,
    ]);
  }

  private async buildUE(ct: string, sub: netdef.Subscriber): Promise<void> {
    const s = this.ctx.defineService(ct, ueransimDockerImage, ["mgmt", "air"]);
    compose.annotate(s, "cpus", 1);
    s.cap_add.push("NET_ADMIN");
    s.devices.push("/dev/net/tun:/dev/net/tun");
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
    await this.ctx.writeFile(`ran-cfg/${ct}.yaml`, c, { s, target: "/ueransim/config/update.yaml" });

    compose.setCommands(s, [
      ...compose.renameNetifs(s, { disableTxOffload: true }),
      "msg Preparing UERANSIM UE config",
      ...compose.mergeConfigFile("/ueransim/config/update.yaml", {
        base: "/ueransim/config/custom-ue.yaml",
        merged: `/ueransim/config/${ct}.yaml`,
      }),
      "sleep 20",
      "msg Starting UERANSIM UE",
      `exec /ueransim/nr-ue -c /ueransim/config/${ct}.yaml -n ${sub.count}`,
    ]);
  }
}
