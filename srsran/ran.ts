import type { Except } from "type-fest";

import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, SRSRAN } from "../types/mod.js";
import srsgnbSchema from "../types/srsgnb.schema.json";
import { file_io, makeSchemaValidator } from "../util/mod.js";
import type { SRSOpts } from "./options.js";
import * as UHD from "./uhd.js";

const gnbDockerImage = "5gdeploy.localhost/srsran5g";
const ueDockerImage = "gradiant/srsran-4g:23_11";
const srate = 23.04;

const validateGNB: (input: unknown) => asserts input is SRSRAN.GnbConfig = makeSchemaValidator<SRSRAN.GnbConfig>(srsgnbSchema);

/** Build RAN functions using srsRAN. */
export async function srsRAN(
    ctx: NetDefComposeContext,
    opts: SRSOpts & netdef.SubscriberSingleDnOpt,
): Promise<void> {
  await new RANBuilder(ctx, opts).build();
}

class RANBuilder {
  constructor(
      private readonly ctx: NetDefComposeContext,
      private readonly opts: SRSOpts & netdef.SubscriberSingleDnOpt,
  ) {
    this.plmn = netdef.splitPLMN(ctx.network.plmn);
  }

  private readonly plmn: netdef.PLMN;

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

    for (const gnb of netdef.listGnbs(this.ctx.network)) {
      await this.buildGNBsdr(gnb, c);
    }
  }

  private async buildZmq(): Promise<void> {
    for (const [gnb, sub] of netdef.pairGnbUe(
      this.ctx.network, { singleDn: this.opts["ue-single-dn"] },
    )) {
      const ue = this.ctx.defineService(gnb.name.replace("gnb", "ue"), ueDockerImage, ["mgmt", "air"]);
      const gnbIP = await this.buildGNBzmq(gnb, compose.getIP(ue, "air"));
      this.buildUE(ue, sub, gnbIP);
    }
  }

  private async buildGNBsdr(gnb: netdef.GNB, c: SRSRAN.GnbConfig): Promise<void> {
    const s = this.ctx.defineService(gnb.name, gnbDockerImage, ["n2", "n3"]);
    compose.annotate(s, "cpus", 4);
    await this.buildGNB(s, gnb, c.ru_sdr, c.cell_cfg);

    if (c.ru_sdr.device_driver === "uhd") {
      UHD.prepareContainer(s, false);
    }
  }

  private async buildGNBzmq(gnb: netdef.GNB, ueIP: string): Promise<string> {
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

  private async buildGNB(
      s: ComposeService, gnb: netdef.GNB, rusdr: SRSRAN.RUSDR,
      cellcfg: Except<SRSRAN.Cell, "plmn" | "tac" | "pci" | "slicing">,
  ): Promise<void> {
    const amfIP = compose.getIP(this.ctx.c, "amf*", "n2");
    const plmn = `${this.plmn.mcc}${this.plmn.mnc}`;
    const tac = Number.parseInt(this.ctx.network.tac, 16);
    const slices = Array.from(netdef.listNssai(this.ctx.network), (snssai) => netdef.splitSNSSAI(snssai).int);

    const c: SRSRAN.GnbConfig = {
      gnb_id: gnb.nci.gnb,
      gnb_id_bit_length: this.ctx.network.gnbIdLength,
      ran_node_name: gnb.name,
      cu_cp: {
        amf: {
          addr: amfIP,
          bind_addr: compose.getIP(s, "n2"),
          supported_tracking_areas: [{
            tac,
            plmn_list: [{ plmn, tai_slice_support_list: slices }],
          }],
        },
        // https://github.com/srsran/srsRAN_Project/discussions/527#discussioncomment-8980792
        inactivity_timer: 7200,
        pdu_session_setup_timeout: 300,
      },
      cu_up: {
        upf: {
          bind_addr: compose.getIP(s, "n3"),
        },
      },
      ru_sdr: rusdr,
      cell_cfg: {
        ...cellcfg,
        pci: gnb.nci.cell,
        plmn,
        tac,
        slicing: slices,
      },
      log: {
        filename: "stdout",
        all_level: "info",
      },
    };
    await this.ctx.writeFile(`ran-cfg/${gnb.name}.yml`, c, { s, target: "/gnb.yml" });

    compose.setCommands(s, [
      ...compose.waitNetifs(s, { disableTxOffload: true }),
      ...compose.waitReachable("AMF", [amfIP]),
      "exec /opt/srsRAN_Project/target/bin/gnb -c /gnb.yml",
    ]);
  }

  private buildUE(s: ComposeService, sub: netdef.Subscriber, gnbIP: string): void {
    s.cap_add.push("NET_ADMIN", "SYS_NICE");
    s.devices.push("/dev/net/tun:/dev/net/tun");
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
    compose.annotate(s, "cpus", 2);
    compose.annotate(s, "ue_supi", sub.supi);

    compose.setCommands(s, [
      ...compose.waitNetifs(s),
      ...compose.waitReachable("gNB", [gnbIP], { mode: "tcp:2000", sleep: 2 }),
      "",
      "ue_route() {",
      "  with_retry ip link show dev tun_srsue &>/dev/null",
      "  msg Setting default route from tun_srsue",
      "  ip route replace default dev tun_srsue",
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
