import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { applyQoS, NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { UERANSIM } from "../types/mod.js";

export const ueransimDockerImage = "5gdeploy.localhost/ueransim";

/** Build RAN functions using UERANSIM. */
export async function ueransimRAN(ctx: NetDefComposeContext): Promise<void> {
  await new UeransimBuilder(ctx).build();
}

class UeransimBuilder {
  constructor(private readonly ctx: NetDefComposeContext) {
    this.plmn = NetDef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: NetDef.PLMN;

  public async build(): Promise<void> {
    for (const [ct, gnb] of compose.suggestNames("gnb", this.ctx.netdef.gnbs)) {
      await this.buildGNB(ct, gnb);
    }

    for (const [ct, sub] of compose.suggestUENames(this.ctx.netdef.listSubscribers({ expandCount: false }))) {
      await this.buildUE(ct, sub);
    }
  }

  private async buildGNB(ct: string, gnb: NetDef.GNB): Promise<void> {
    const s = this.ctx.defineService(ct, ueransimDockerImage, ["air", "n2", "n3"]);

    const c: PartialDeep<UERANSIM.gnb.Config> = {
      mcc: this.plmn.mcc,
      mnc: this.plmn.mnc,
      nci: Number.parseInt(gnb.nci, 16),
      idLength: this.ctx.network.gnbIdLength,
      tac: this.ctx.netdef.tac,
      linkIp: s.networks.air!.ipv4_address,
      ngapIp: s.networks.n2!.ipv4_address,
      gtpIp: s.networks.n3!.ipv4_address,
      amfConfigs: Array.from(
        this.ctx.gatherIPs("amf", "n2"),
        (address) => ({ address, port: 38412 }),
      ),
      slices: Array.from(
        this.ctx.netdef.nssai,
        (snssai) => NetDef.splitSNSSAI(snssai).int,
      ),
    };
    await this.ctx.writeFile(`ran-cfg/${ct}.yaml`, c, { s, target: "/ueransim/config/update.yaml" });

    compose.setCommands(s, [
      ...compose.renameNetifs(s, { pipeworkWait: true }),
      ...applyQoS(s),
      "msg Preparing UERANSIM gNB config",
      ...compose.mergeConfigFile("/ueransim/config/update.yaml", {
        base: "/ueransim/config/custom-gnb.yaml",
        merged: `/ueransim/config/${ct}.yaml`,
      }),
      "sleep 10",
      "msg Starting UERANSIM gNB",
      `exec /ueransim/nr-gnb -c /ueransim/config/${ct}.yaml`,
    ]);
  }

  private async buildUE(ct: string, sub: NetDef.Subscriber): Promise<void> {
    const s = this.ctx.defineService(ct, ueransimDockerImage, ["air"]);
    s.cap_add.push("NET_ADMIN");
    s.devices.push("/dev/net/tun:/dev/net/tun");
    compose.annotate(s, "ue_supi", NetDef.listSUPIs(sub).join(","));

    const nssai: UERANSIM.Slice[] = Array.from(
      sub.requestedNSSAI ?? sub.subscribedNSSAI,
      ({ snssai }) => NetDef.splitSNSSAI(snssai).int,
    );
    const c: PartialDeep<UERANSIM.ue.Config> = {
      supi: `imsi-${sub.supi}`,
      mcc: this.plmn.mcc,
      mnc: this.plmn.mnc,
      key: sub.k,
      op: sub.opc,
      opType: "OPC",
      gnbSearchList: this.ctx.gatherIPs(sub.gnbs, "air"),
      sessions: Array.from(
        sub.requestedDN,
        ({ dnn, snssai }) => ({
          type: "IPv4",
          apn: dnn,
          slice: NetDef.splitSNSSAI(snssai).int,
        }),
      ),
      "configured-nssai": nssai,
      "default-nssai": nssai,
    };
    await this.ctx.writeFile(`ran-cfg/${ct}.yaml`, c, { s, target: "/ueransim/config/update.yaml" });

    compose.setCommands(s, [
      ...compose.renameNetifs(s, { pipeworkWait: true }),
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
