import type { SetOptional } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import { type ComposeService, type SRS } from "../types/mod.js";
import srsgnbSchema from "../types/srsgnb.schema.json";
import { file_io, makeSchemaValidator } from "../util/mod.js";
import type { SRSOpts } from "./options.js";

const gnbDockerImage = "gradiant/srsran-5g:24_04";
const ueDockerImage = "gradiant/srsran-4g:23_11";
const srate = 23.04;

const validateGNB: (input: unknown) => asserts input is SRS.gnb.Config = makeSchemaValidator<SRS.gnb.Config>(srsgnbSchema);

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
    const sdrFile = this.opts["srs-gnb-sdr"];
    if (sdrFile) {
      await this.buildSdr(sdrFile);
    } else {
      await this.buildZmq();
    }
  }

  private async buildSdr(sdrFile: string): Promise<void> {
    const c = await file_io.readYAML(sdrFile);
    validateGNB(c);

    for (const gnb of this.ctx.netdef.gnbs) {
      await this.buildGNBsdr(gnb, c);
    }
  }

  private async buildZmq(): Promise<void> {
    for (const [gnb, sub] of NetDef.pairGnbUe(this.ctx.netdef)) {
      const ue = this.ctx.defineService(gnb.name.replace("gnb", "ue"), ueDockerImage, ["mgmt", "air"]);
      const gnbIP = await this.buildGNBzmq(gnb, compose.getIP(ue, "air"));
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
        // /dev/bus/usb must be a bind volume and not in s.devices; putting this in s.devices would
        // cause UHD to report "USB open failed: insufficient permissions" error when the USRP
        // hardware is initialized for the first time after re-plugging, because UHD may reset the
        // USRP hardware from high-speed to SuperSpeed, changing its inode device number
        type: "bind",
        source: "/dev/bus/usb",
        target: "/dev/bus/usb",
      });
    }
  }

  private async buildGNBzmq(gnb: NetDef.GNB, ueIP: string): Promise<string> {
    const s = this.ctx.defineService(gnb.name, gnbDockerImage, ["air", "n2", "n3"]);
    compose.annotate(s, "cpus", 3);

    await this.buildGNB(s, gnb, {
      srate,
      device_driver: "zmq",
      device_args: [
        `tx_port=tcp://${compose.getIP(s, "air")}:2000`,
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
    return compose.getIP(s, "air");
  }

  private async buildGNB(s: ComposeService, gnb: NetDef.GNB, rusdr: SRS.gnb.RUSDR, cellcfg: SetOptional<SRS.gnb.Cell, "plmn" | "tac" | "pci">): Promise<void> {
    const amfIP = this.ctx.gatherIPs("amf", "n2")[0]!;

    const c: SRS.gnb.Config = {
      gnb_id: gnb.nci.gnb,
      gnb_id_bit_length: this.ctx.network.gnbIdLength,
      ran_node_name: gnb.name,
      slicing: Array.from(this.ctx.netdef.nssai, (snssai) => NetDef.splitSNSSAI(snssai).int),
      amf: {
        addr: amfIP,
        bind_addr: compose.getIP(s, "n2"),
        n2_bind_addr: compose.getIP(s, "n2"),
        n3_bind_addr: compose.getIP(s, "n3"),
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
      ...compose.renameNetifs(s),
      ...compose.waitReachable("AMF", [amfIP]),
      "exec /opt/srsRAN_Project/target/bin/gnb -c /gnb.yml",
    ]);
  }

  private buildUE(s: ComposeService, sub: NetDef.Subscriber, gnbIP: string): void {
    compose.annotate(s, "cpus", 2);
    compose.annotate(s, "ue_supi", sub.supi);
    s.cap_add.push("NET_ADMIN", "SYS_NICE");
    s.devices.push("/dev/net/tun:/dev/net/tun");

    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...compose.waitReachable("gNB", [gnbIP], { mode: "tcp:2000", sleep: 2 }),
      "",
      "ue_route() {",
      "  with_retry ip link show dev tun_srsue &>/dev/null",
      "  msg Setting default route from tun_srsue",
      "  ip route add default dev tun_srsue",
      "  msg Listing IP routes",
      "  ip route list type unicast",
      "}",
      "ue_route &",
      "",
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
      UE_ADDRESS: compose.getIP(s, "air"),
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
