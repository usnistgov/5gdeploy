import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, SRS } from "../types/mod.js";

const srate = "23.04";

/** Build RAN functions using srsRAN. */
export async function srsRAN(ctx: NetDefComposeContext): Promise<void> {
  await new SRSBuilder(ctx).build();
}

class SRSBuilder {
  constructor(private readonly ctx: NetDefComposeContext) {
    this.plmn = NetDef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: NetDef.PLMN;

  public async build(): Promise<void> {
    for (const [gnb, sub] of NetDef.pairGnbUe(this.ctx.netdef)) {
      await this.buildGnbUe(gnb, sub);
    }
  }

  private async buildGnbUe(gnb: NetDef.GNB, sub: NetDef.Subscriber): Promise<void> {
    const gnbService = this.ctx.defineService(gnb.name, "gradiant/srsran-5g:24_04", ["air", "n2", "n3"]);
    const ueService = this.ctx.defineService(gnb.name.replace("gnb", "ue"), "gradiant/srsran-4g:23_11", ["air"]);
    await this.buildGNB(gnbService, ueService, gnb);
    this.buildUE(ueService, gnbService, sub);
  }

  private async buildGNB(s: ComposeService, ue: ComposeService, gnb: NetDef.GNB): Promise<void> {
    const c: SRS.gnb.Config = {
      gnb_id: gnb.nci.gnb,
      gnb_id_bit_length: this.ctx.network.gnbIdLength,
      ran_node_name: gnb.name,
      slicing: Array.from(this.ctx.netdef.nssai, (snssai) => NetDef.splitSNSSAI(snssai).int),
      amf: {
        addr: this.ctx.gatherIPs("amf", "n2")[0]!,
        bind_addr: s.networks.n2!.ipv4_address,
        n2_bind_addr: s.networks.n2!.ipv4_address,
        n3_bind_addr: s.networks.n3!.ipv4_address,
      },
      ru_sdr: {
        srate,
        device_driver: "zmq",
        device_args: [
          `tx_port=tcp://${s.networks.air!.ipv4_address}:2000`,
          `rx_port=tcp://${ue.networks.air!.ipv4_address}:2001`,
          "id=gnb",
          `base_srate=${srate}e6`,
        ].join(","),
        tx_gain: 75,
        rx_gain: 75,
      },
      cell_cfg: {
        pci: gnb.nci.cell,
        dl_arfcn: 368500,
        common_scs: 15,
        channel_bandwidth_MHz: 20,
        plmn: `${this.plmn.mcc}${this.plmn.mnc}`,
        tac: this.ctx.netdef.tac,
        pdcch: {
          common: { ss0_index: 0, coreset0_index: 12 },
          dedicated: { ss2_type: "common", dci_format_0_1_and_1_1: false },
        },
        prach: {
          prach_config_index: 1,
        },
      },
      log: {
        filename: "stdout",
        all_level: "info",
      },
    };
    await this.ctx.writeFile(`ran-cfg/${gnb.name}.yml`, c, { s, target: "/gnb.yml" });

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      "sleep 10",
      "/opt/srsRAN_Project/target/bin/gnb -c /gnb.yml",
    ]);
  }

  private buildUE(s: ComposeService, gnb: ComposeService, sub: NetDef.Subscriber): void {
    compose.annotate(s, "ue_supi", sub.supi);
    s.privileged = true;
    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      "sleep 20",
      "msg Starting srsRAN 4G UE in 5G SA mode",
      "/entrypoint.sh ue || true",
      "msg srsRAN 4G UE has exited",
      "cat ue.conf",
    ]);
    Object.assign(s.environment, {
      GTP_BIND_ADDR: "no-gtp",
      S1C_BIND_ADDR: "no-s1c",
      MME_BIND_ADDR: "no-mme",
      ENB_HOSTNAME: "",
      ENB_ADDRESS: gnb.networks.air!.ipv4_address,
      UE_HOSTNAME: "",
      UE_ADDRESS: s.networks.air!.ipv4_address,
      DL_EARFCN: 2850,
      BANDS: 3,
      APN: sub.requestedDN[0]?.dnn,
      APN_PROTOCOL: "ipv4",
      SRATE: "23.04",
      TX_GAIN: 50,
      RX_GAIN: 40,
      OPC: sub.opc,
      KEY: sub.k,
      MCC: this.plmn.mcc,
      MNC: this.plmn.mnc,
      MSISDN: sub.supi.slice(this.plmn.mcc.length + this.plmn.mnc.length),
      EUTRA_NOF_CARRIERS: 0,
      NR_NOF_CARRIERS: 1,
      NR_MAX_NOF_PRB: 106,
      NR_NOF_PRB: 106,
      SRSUE_5G: "true",
      ZMQ: "true",
    });
  }
}
