import { AggregateAjvError } from "@segment/ajv-human-errors";
import Ajv from "ajv";
import type { SetOptional } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, SRS } from "../types/mod.js";
import srsgnbSchema from "../types/srsgnb.schema.json";
import { file_io } from "../util/mod.js";
import type { SRSOpts } from "./options.js";

const gnbDockerImage = "5gdeploy.localhost/srsgnb";
const ueDockerImage = "gradiant/srsran-4g:23_11";
const srate = 23.04;

const srsgnbValidate = new Ajv({
  allErrors: true,
  verbose: true,
}).compile(srsgnbSchema);

/** Build RAN functions using srsRAN. */
export async function srsRAN(ctx: NetDefComposeContext, opts: SRSOpts): Promise<void> {
  await new RANBuilder(ctx, opts).build();
}

class RANBuilder {
  constructor(private readonly ctx: NetDefComposeContext, private readonly opts: SRSOpts) {
    this.plmn = NetDef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: NetDef.PLMN;

  public async build(): Promise<void> {
    const sdrFile = this.opts["oai-gnb-sdr"];
    if (sdrFile) {
      await this.buildSdr(sdrFile);
    } else {
      await this.buildZmq();
    }
  }

  private async buildSdr(sdrFile: string): Promise<void> {
    const c = await file_io.readYAML(sdrFile);
    const valid = srsgnbValidate(c);
    if (!valid) {
      throw new AggregateAjvError(srsgnbValidate.errors!);
    }

    for (const gnb of this.ctx.netdef.gnbs) {
      await this.buildGNBsdr(gnb, c as any);
    }
  }

  private async buildZmq(): Promise<void> {
    for (const [gnb, sub] of NetDef.pairGnbUe(this.ctx.netdef)) {
      const ue = this.ctx.defineService(gnb.name.replace("gnb", "ue"), ueDockerImage, ["air"]);
      const gnbIP = await this.buildGNBzmq(gnb, ue.networks.air!.ipv4_address);
      this.buildUE(ue, sub, gnbIP);
    }
  }

  private async buildGNBsdr(gnb: NetDef.GNB, c: SRS.gnb.Config): Promise<void> {
    const s = this.ctx.defineService(gnb.name, gnbDockerImage, ["n2", "n3"]);
    compose.annotate(s, "cpus", 4);
    await this.buildGNB(s, gnb, c.ru_sdr, c.cell_cfg);

    if (c.ru_sdr.device_driver === "uhd") {
      s.privileged = true;
      s.volumes.push({
        type: "bind",
        source: "/dev/bus/usb",
        target: "/dev/bus/usb",
      });
    }
  }

  private async buildGNBzmq(gnb: NetDef.GNB, ueIP: string): Promise<string> {
    const s = this.ctx.defineService(gnb.name, gnbDockerImage, ["air", "n2", "n3"]);
    compose.annotate(s, "cpus", 1);
    await this.buildGNB(s, gnb, {
      srate,
      device_driver: "zmq",
      device_args: [
        `tx_port=tcp://${s.networks.air!.ipv4_address}:2000`,
        `rx_port=tcp://${ueIP}:2001`,
        "id=gnb",
        `base_srate=${srate}e6`,
      ].join(","),
      tx_gain: 75,
      rx_gain: 75,
    }, {
      dl_arfcn: 368500,
      common_scs: 15,
      channel_bandwidth_MHz: 20,
      pdcch: {
        common: { ss0_index: 0, coreset0_index: 12 },
        dedicated: { ss2_type: "common", dci_format_0_1_and_1_1: false },
      },
      prach: {
        prach_config_index: 1,
      },
    });
    return s.networks.air!.ipv4_address;
  }

  private async buildGNB(s: ComposeService, gnb: NetDef.GNB, rusdr: SRS.gnb.RUSDR, cellcfg: SetOptional<SRS.gnb.Cell, "plmn" | "tac" | "pci">): Promise<void> {
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
      cu_cp: {
        // https://github.com/srsran/srsRAN_Project/discussions/527#discussioncomment-8980792
        inactivity_timer: 7200,
      },
      ru_sdr: rusdr,
      cell_cfg: {
        ...cellcfg,
        pci: gnb.nci.cell,
        plmn: `${this.plmn.mcc}${this.plmn.mnc}`,
        tac: this.ctx.netdef.tac,
      },
      log: {
        filename: "stdout",
        all_level: "info",
      },
    };
    await this.ctx.writeFile(`ran-cfg/${gnb.name}.yml`, c, { s, target: "/gnb.yml" });

    compose.setCommands(s, [
      ...compose.renameNetifs(s, { pipeworkWait: true }),
      "sleep 10",
      "exec /opt/srsRAN_Project/target/bin/gnb -c /gnb.yml",
    ]);
  }

  private buildUE(s: ComposeService, sub: NetDef.Subscriber, gnbIP: string): void {
    compose.annotate(s, "cpus", 1);
    compose.annotate(s, "ue_supi", sub.supi);
    s.privileged = true;
    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      "sleep 20",
      "msg Starting srsRAN 4G UE in 5G SA mode",
      "exec /entrypoint.sh ue",
    ]);
    Object.assign(s.environment, {
      GTP_BIND_ADDR: "no-gtp",
      S1C_BIND_ADDR: "no-s1c",
      MME_BIND_ADDR: "no-mme",
      ENB_HOSTNAME: "",
      ENB_ADDRESS: gnbIP,
      UE_HOSTNAME: "",
      UE_ADDRESS: s.networks.air!.ipv4_address,
      DL_EARFCN: 2850,
      BANDS: 3,
      APN: sub.requestedDN[0]?.dnn,
      APN_PROTOCOL: "ipv4",
      SRATE: srate,
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
