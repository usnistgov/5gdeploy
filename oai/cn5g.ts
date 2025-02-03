import path from "node:path";

import * as yaml from "js-yaml";
import { sortBy } from "sort-by-typescript";

import { compose, http2Port, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import { type CN5G, type ComposeService } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import { getTaggedImageName, makeSUIL } from "./common.js";
import type { OAIOpts } from "./options.js";

/** OAI-CN5G images known to have iproute2 package. */
const iproute2Available = new Set(["upf"]);

/** OAI-CN5G builder common base. */
export abstract class CN5GBuilder {
  constructor(
      protected readonly ctx: NetDefComposeContext,
      protected readonly opts: OAIOpts,
  ) {
    this.plmn = netdef.splitPLMN(ctx.network.plmn);
    this.hasNRF = opts["oai-cn5g-nrf"];
    this.hasPCF = opts["oai-cn5g-pcf"];
  }

  protected readonly plmn: netdef.PLMN;
  protected readonly hasNRF: boolean;
  protected readonly hasPCF: boolean;

  /** YAML config shared among network functions. */
  protected c!: CN5G.Config;
  private configOutputFilename!: string;

  /**
   * Load YAML config into `this.c`.
   * @param templateFilename - Template filename relative to oai-cn5g-fed repository checkout.
   * @param outputFilename - Output filename relative to output Compose context.
   */
  protected async loadConfig(templateFilename: string, outputFilename: string): Promise<void> {
    const c = await file_io.readYAML(path.resolve(import.meta.dirname, "fed/conf", templateFilename), {
      once: true,
      schema: yaml.FAILSAFE_SCHEMA,
    });
    this.c = JSON.parse(JSON.stringify(c, (key, value) => {
      switch (value) {
        case "true":
        case "yes": {
          return true;
        }
        case "false":
        case "no": {
          return false;
        }
      }
      if (typeof value === "string" && /^\d+$/.test(value) &&
          !["sd", "mcc", "mnc", "amf_region_id", "amf_set_id", "amf_pointer", "dnn"].includes(key)) {
        return Number.parseInt(value, 10);
      }
      return value;
    }));

    this.c.register_nf.general = this.hasNRF;
    if (!this.hasNRF) {
      delete this.c.nfs.nrf;
    }

    this.configOutputFilename = outputFilename;
  }

  /** Save `this.c` to the config path specified in {@link loadConfig}. */
  protected async saveConfig(): Promise<void> {
    await this.ctx.writeFile(this.configOutputFilename, this.c);
  }

  /**
   * Define network function service container.
   * @param ct - Container name.
   * @param nf - Network function name.
   * @param nfc - Network function interfaces config.
   * @param db - Whether the network function needs database.
   * @returns Compose service of the network function.
   */
  protected async defineService(ct: string, nf: string, nfc: CN5G.NF, db: boolean): Promise<ComposeService> {
    const nets: Array<[net: string, intf: CN5G.NF.Interface | undefined]> = [];
    if (db) {
      nets.push(["db", undefined]);
    }
    for (const [key, intf] of Object.entries(nfc)) {
      if (key === "sbi") {
        intf.port = http2Port;
        nets.push(["cp", intf]);
      } else if (/^n\d+$/.test(key)) {
        nets.push([key, intf]);
      }
    }
    nets.sort(sortBy("0"));
    for (const [i, [net, intf]] of nets.entries()) {
      if (intf) {
        intf.interface_name = iproute2Available.has(nf) ? net : `eth${i}`;
      }
      // XXX ethI is incompatible with Ethernet bridge
    }

    const image = await getTaggedImageName(this.opts, nf);
    const s = this.ctx.defineService(ct, image, Array.from(nets, ([net]) => net));
    s.stop_signal = "SIGQUIT";
    s.cap_add.push("NET_ADMIN");
    s.volumes.push({
      type: "bind",
      source: `./${this.configOutputFilename}`,
      target: `/openair-${nf}/etc/config.yaml`,
      read_only: true,
    });

    nfc.host = compose.getIP(s, "cp");
    compose.setCommands(s, this.makeExecCommands(s, nf));
    return s;
  }

  /** Construct service commands. */
  protected *makeExecCommands(s: ComposeService, nf: string, insert: Iterable<string> = []): Iterable<string> {
    if (iproute2Available.has(nf)) {
      yield* compose.renameNetifs(s);
    } else {
      yield "msg Listing IP addresses";
      yield "ip addr list up || /usr/sbin/ifconfig || true";
    }
    yield* insert;
    yield `msg Starting oai_${nf}`;
    yield `exec ./bin/oai_${nf} -c ./etc/config.yaml -o`;
  }

  /** Populate DNNs and NSSAI in `this.c`. */
  protected updateConfigDNNs(): void {
    this.c.snssais = Array.from(netdef.listNssai(this.ctx.network), (snssai) => netdef.splitSNSSAI(snssai).ih);
    this.c.dnns = this.ctx.network.dataNetworks.map((dn): CN5G.DNN => ({
      dnn: dn.dnn,
      pdu_session_type: "IPV4",
      ipv4_subnet: dn.subnet,
    }));
  }

  /** Construct UPFInfo structure. */
  protected makeUPFInfo(peers: netdef.UPFPeers): CN5G.upf.UPFInfo {
    return {
      sNssaiUpfInfoList: makeSUIL(this.ctx.network, peers, { withDnai: this.hasPCF }),
    };
  }
}
