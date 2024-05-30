import path from "node:path";

import sql from "sql-tagged-template-literal";
import assert from "tiny-invariant";

import * as compose from "../compose/mod.js";
import { NetDef, type NetDefComposeContext, NetDefDN } from "../netdef-compose/mod.js";
import type { CN5G, ComposeService } from "../types/mod.js";
import { file_io, hexPad } from "../util/mod.js";
import * as oai_conf from "./conf.js";
import type { OAIOpts } from "./options.js";

const iproute2Available = new Set(["upf"]); // images known to have iproute2 package

abstract class CN5GBuilder {
  constructor(
      protected readonly ctx: NetDefComposeContext,
      protected readonly opts: OAIOpts,
  ) {}

  protected get netdef() { return this.ctx.netdef; }
  protected c!: CN5G.Config;

  protected async defineService(ct: string, nf: string, c: CN5G.NF, db: boolean, configPath: string): Promise<ComposeService> {
    const nets: Array<[net: string, intf: CN5G.NF.Interface | undefined]> = [];
    if (db) {
      nets.push(["db", undefined]);
    }
    for (const key of Object.keys(c)) {
      if (key === "sbi") {
        nets.push(["cp", c.sbi]);
      } else if (/^n\d+$/.test(key)) {
        nets.push([key, c[key as `n${number}`]]);
      }
    }
    nets.sort(([a], [b]) => a.localeCompare(b));
    for (const [i, [net, intf]] of nets.entries()) {
      if (intf) {
        intf.interface_name = iproute2Available.has(nf) ? net : `eth${i}`;
      }
      // XXX ethI is incompatible with Ethernet bridge
    }

    const image = await oai_conf.getTaggedImageName(this.opts, nf);
    const s = this.ctx.defineService(ct, image, Array.from(nets, ([net]) => net));
    s.stop_signal = "SIGQUIT";
    s.cap_add.push("NET_ADMIN");
    s.volumes.push({
      type: "bind",
      source: `./${configPath}`,
      target: `/openair-${nf}/etc/config.yaml`,
      read_only: true,
    });

    c.host = s.networks.cp!.ipv4_address;

    compose.setCommands(s, this.makeExecCommands(s, nf));
    return s;
  }

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

  protected updateConfigDNNs(): void {
    this.c.snssais = this.netdef.nssai.map((snssai) => NetDef.splitSNSSAI(snssai).ih);
    this.c.dnns = this.ctx.network.dataNetworks.map((dn): CN5G.DNN => ({
      dnn: dn.dnn,
      pdu_session_type: "IPV4",
      ipv4_subnet: dn.subnet,
    }));
  }
}

class CPBuilder extends CN5GBuilder {
  public async build(): Promise<void> {
    this.c = await oai_conf.loadCN5G();
    await this.buildSQL();
    const configPath = "cp-cfg/config.yaml";
    for (const [nf, c] of Object.entries(this.c.nfs).filter(([nf]) => nf !== "upf")) {
      await this.defineService(nf, nf, c, true, configPath);
    }

    this.updateConfigDNNs();
    this.updateConfigAMF();
    this.updateConfigSMF();
    delete this.c.nfs.upf;
    delete this.c.upf;
    await this.ctx.writeFile(configPath, this.c);
  }

  private async buildSQL(): Promise<void> {
    const s = this.ctx.defineService("sql", compose.mysql.image, ["db"]);
    compose.mysql.init(s, "cp-sql");
    const dbc = this.c.database;
    dbc.host = s.networks.db!.ipv4_address;
    dbc.user = "oai";
    dbc.password = "oai";
    dbc.database_name = "oai_db";

    await this.ctx.writeFile("cp-sql/oai_db.sql", await compose.mysql.join(
      [ // sql`` template literal is only meant for escaping values and cannot be used on database names
        `CREATE DATABASE ${dbc.database_name}`,
        `USE ${dbc.database_name}`,
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ${dbc.database_name}.* TO ${
          dbc.user}@'%' IDENTIFIED BY '${dbc.password}'`,
      ],
      await file_io.readText(path.resolve(oai_conf.composePath, "database/oai_db2.sql")),
      this.populateSQL(),
    ));
  }

  private *populateSQL(): Iterable<string> {
    const { mcc, mnc } = NetDef.splitPLMN(this.ctx.network.plmn);
    const servingPlmnid = `${mcc}${mnc}`;
    yield "SELECT @sqn_json:=sequenceNumber FROM AuthenticationSubscription LIMIT 1";
    yield "DELETE FROM AccessAndMobilitySubscriptionData";
    yield "DELETE FROM AuthenticationSubscription";
    yield "DELETE FROM SessionManagementSubscriptionData";
    for (const sub of this.netdef.listSubscribers()) {
      const nssai = {
        defaultSingleNssais: sub.subscribedNSSAI.map(({ snssai }) => NetDef.splitSNSSAI(snssai).ih),
      };
      yield sql`
        INSERT AccessAndMobilitySubscriptionData (ueid,servingPlmnid,nssai)
        VALUES (${sub.supi},${servingPlmnid},${nssai})
      `;
      yield sql`
        INSERT AuthenticationSubscription (ueid,authenticationMethod,encPermanentKey,protectionParameterId,sequenceNumber,authenticationManagementField,algorithmId,encOpcKey,encTopcKey,vectorGenerationInHss,n5gcAuthMethod,rgAuthenticationInd,supi)
        VALUES (${sub.supi},'5G_AKA',${sub.k},${sub.k},@sqn_json,'8000','milenage',${sub.opc},NULL,NULL,NULL,NULL,${sub.supi})
      `;
    }
  }

  private updateConfigAMF(): void {
    const { amfs } = this.netdef;
    assert(amfs.length === 1, "support exactly 1 AMF");
    const amf = amfs[0]!;

    const c = this.c.amf!;
    c.amf_name = amf.name;
    if (!(this.c.register_nf.smf ?? this.c.register_nf.general)) {
      // SMF selection depends on SMF registration in NRF
      c.support_features_options.enable_smf_selection = false;
    }
    c.supported_integrity_algorithms = c.supported_integrity_algorithms.filter((algo) => algo !== "NIA0");

    const plmn = NetDef.splitPLMN(this.ctx.network.plmn);
    c.served_guami_list = [{
      ...plmn,
      amf_region_id: hexPad(amf.amfi[0], 2),
      amf_set_id: hexPad(amf.amfi[1], 3),
      amf_pointer: hexPad(amf.amfi[2], 2),
    }];
    c.plmn_support_list = [{
      ...plmn,
      tac: `0x${hexPad(this.netdef.tac, 4)}`,
      nssai: this.c.snssais,
    }];
  }

  private updateConfigSMF(): void {
    const { smfs } = this.netdef;
    assert(smfs.length === 1, "support exactly 1 SMF");

    const c = this.c.smf!;

    const upfTpl = c.upfs[0]!;
    c.upfs = this.ctx.network.upfs.map((upf): CN5G.smf.UPF => {
      const ct = this.ctx.c.services[upf.name]!;
      return {
        ...upfTpl,
        host: ct.networks.n4!.ipv4_address,
      };
    });

    c.smf_info.sNssaiSmfInfoList = this.netdef.nssai.map((snssai): CN5G.smf.SNSSAIInfo => {
      const dns = this.ctx.network.dataNetworks.filter((dn) => dn.snssai === snssai);
      return {
        sNssai: NetDef.splitSNSSAI(snssai).ih,
        dnnSmfInfoList: dns.map(({ dnn }) => ({ dnn })),
      };
    });

    const localSubscriptionTpl = c.local_subscription_infos[0]!;
    c.local_subscription_infos = this.ctx.network.dataNetworks.map((dn): CN5G.smf.LocalSubscription => ({
      ...localSubscriptionTpl,
      single_nssai: NetDef.splitSNSSAI(dn.snssai).ih,
      dnn: dn.dnn,
    }));
  }
}

class UPBuilder extends CN5GBuilder {
  public async build(): Promise<void> {
    NetDefDN.defineDNServices(this.ctx);

    this.c = await oai_conf.loadCN5G();
    // rely on hosts entry because UP is created before CP so that NRF and SMF IPs are unknown
    this.c.nfs.nrf!.host = "nrf.br-cp"; // assuming only one NRF
    this.c.upf!.remote_n6_gw = "127.0.0.1";
    this.c.upf!.smfs = this.netdef.smfs.map((smf): CN5G.upf.SMF => ({ host: `${smf.name}.br-n4` }));
    this.c.nfs.smf!.host = this.c.upf!.smfs[0]!.host;

    this.updateConfigDNNs();
    this.c.upf!.support_features.enable_bpf_datapath = this.opts["oai-upf-bpf"];
    this.c.upf!.support_features.enable_snat = false;
    for (const nf of Object.keys(this.c.nfs) as CN5G.NFName[]) {
      if (!["nrf", "smf", "upf"].includes(nf)) {
        delete this.c.nfs[nf]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
      }
    }
    delete this.c.amf;
    delete this.c.smf;

    for (const [ct, upf] of compose.suggestNames("upf", this.ctx.network.upfs)) {
      const configPath = `up-cfg/${ct}.yaml`;
      const s = await this.defineService(ct, "upf", this.c.nfs.upf!, false, configPath);
      compose.annotate(s, "cpus", this.opts["oai-upf-workers"]);
      s.devices.push("/dev/net/tun:/dev/net/tun");

      const peers = this.netdef.gatherUPFPeers(upf);
      assert(peers.N9.length === 0, "N9 not supported");
      compose.setCommands(s, this.makeExecCommands(s, "upf", NetDefDN.makeUPFRoutes(this.ctx, peers)));

      this.updateConfigUPF(peers);
      await this.ctx.writeFile(configPath, this.c);
    }

    NetDefDN.setDNCommands(this.ctx);
  }

  private updateConfigUPF(peers: NetDef.UPFPeers): void {
    const { sNssaiUpfInfoList } = this.c.upf!.upf_info;
    sNssaiUpfInfoList.splice(0, Infinity);
    for (const snssai of this.netdef.nssai) {
      const sPeers = peers.N6IPv4.filter((peer) => peer.snssai === snssai);
      if (sPeers.length === 0) {
        continue;
      }
      sNssaiUpfInfoList.push({
        sNssai: NetDef.splitSNSSAI(snssai).ih,
        dnnUpfInfoList: sPeers.map(({ dnn }) => ({ dnn })),
      });
    }
  }
}

/** Build CP functions using OAI-CN5G. */
export async function oaiCP(ctx: NetDefComposeContext, opts: OAIOpts): Promise<void> {
  const b = new CPBuilder(ctx, opts);
  await b.build();
}

/** Build UP functions using oai-cn5g-upf as UPF. */
export async function oaiUP(ctx: NetDefComposeContext, opts: OAIOpts): Promise<void> {
  const b = new UPBuilder(ctx, opts);
  await b.build();
}
