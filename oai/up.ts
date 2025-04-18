import { compose, http2Port, makeUPFRoutes, type netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { CN5G } from "../types/mod.js";
import { assert } from "../util/mod.js";
import { CN5GBuilder } from "./cn5g.js";
import type { OAIOpts } from "./options.js";

/** Build oai-cn5g-upf. */
export async function oaiUP(ctx: NetDefComposeContext, upf: netdef.UPF, opts: OAIOpts): Promise<void> {
  const b = new UPBuilder(ctx, opts);
  await b.build(upf);
}

class UPBuilder extends CN5GBuilder {
  private useBPF!: boolean;

  public async build({ name: ct, peers }: netdef.UPF): Promise<void> {
    this.useBPF = this.opts["oai-upf-bpf"];

    await this.loadConfig("basic_nrf_config.yaml", `up-cfg/${ct}.yaml`);
    delete this.c.database;
    delete this.c.amf;
    delete this.c.smf;
    for (const [nf, nfc] of Object.entries(this.c.nfs)) {
      // if NRF is disabled, c.nfs.nrf is deleted by loadTemplateConfig
      if (["nrf", "smf", "upf"].includes(nf)) {
        nfc.sbi.port = http2Port;
      } else {
        delete this.c.nfs[nf as CN5G.NFName]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
      }
    }

    const s = await this.defineService(ct, "upf", this.c.nfs.upf!, false);
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
    compose.annotate(s, "cpus", this.opts["oai-upf-workers"]);
    if (this.useBPF) {
      s.cap_add.push("BPF", "SYS_ADMIN", "SYS_RESOURCE");
    } else {
      s.devices.push("/dev/net/tun:/dev/net/tun");
    }

    assert(peers.N9.length === 0, "N9 not supported");
    compose.setCommands(s, this.makeExecCommands(s, "upf", makeUPFRoutes(this.ctx, peers)));

    this.ctx.finalize.push(async () => {
      this.updateConfigUPF(peers); // depends on known NRF and SMF IPs
      await this.saveConfig();
    });
  }

  private updateConfigUPF(peers: netdef.UPF.Peers): void {
    if (this.hasNRF) {
      this.c.nfs.nrf!.host = compose.getIP(this.ctx.c, "nrf", "cp");
    }

    const c = this.c.upf!;
    c.smfs = Array.from(
      compose.listByNf(this.ctx.c, "smf"),
      (smf, i) => {
        if (i === 0) {
          this.c.nfs.smf!.host = compose.getIP(smf, "cp");
        }
        return { host: compose.getIP(smf, "n4") };
      },
    );

    this.updateConfigDNNs();
    c.support_features.enable_bpf_datapath = this.useBPF;
    c.support_features.enable_snat = false;
    if (peers.N6IPv4.length > 0) {
      c.remote_n6_gw = compose.getIP(this.ctx.c, `dn_${peers.N6IPv4[0]!.dnn}`, "n6");
    }
    c.upf_info = this.makeUPFInfo(peers);
  }
}
