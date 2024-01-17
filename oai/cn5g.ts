import * as fs from "node:fs/promises";
import path from "node:path";

import assert from "minimalistic-assert";
import sql from "sql-tagged-template-literal";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import * as NetDefDN from "../netdef-compose/dn.js";
import type { ComposeService } from "../types/compose.js";
import type * as CN5G from "../types/oai-cn5g.js";
import * as oai_conf from "./conf.js";

function hexPad(value: number, length: number): string {
  return value.toString(16).padStart(length, "0");
}

abstract class CN5GBuilder {
  constructor(protected readonly ctx: NetDefComposeContext) {}
  protected c!: CN5G.Config;

  protected defineService(ct: string, nf: string, c: CN5G.NF, db: boolean, configPath: string): ComposeService {
    const nets: string[] = [];
    if (db) {
      nets.push("db");
    }
    for (const key of Object.keys(c)) {
      if (key === "sbi") {
        nets.push("cp");
      } else if (/^n\d+$/.test(key)) {
        nets.push(key);
      }
    }
    nets.sort((a, b) => a.localeCompare(b));
    for (const [i, net] of nets.entries()) {
      switch (net) {
        case "cp": {
          c.sbi.interface_name = `eth${i}`;
          break;
        }
        case "db": {
          break;
        }
        default: {
          assert(/^n\d+$/.test(net));
          c[net as `n${number}`]!.interface_name = `eth${i}`;
          break;
        }
      }
      // XXX incompatible with Ethernet bridge
    }

    const s = this.ctx.defineService(ct, `oaisoftwarealliance/oai-${nf}`, nets);
    s.cap_add.push("NET_ADMIN");
    s.volumes.push({
      type: "bind",
      source: `./${configPath}`,
      target: `/openair-${nf}/etc/config.yaml`,
    });

    c.host = s.networks.cp!.ipv4_address;

    compose.setCommands(s, this.makeExecCommands(nf));
    return s;
  }

  protected *makeExecCommands(nf: string): Iterable<string> {
    yield "msg Listing IP addresses";
    yield "ip addr list up || /usr/sbin/ifconfig || true";
    yield `msg Starting oai_${nf}`;
    yield `exec ./bin/oai_${nf} -c ./etc/config.yaml -o`;
  }

  protected updateConfigDNNs(): void {
    this.c.snssais = this.ctx.netdef.nssai.map((snssai) => NetDef.splitSNSSAI(snssai).ih);
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
      this.defineService(nf, nf, c, true, configPath);
    }

    this.updateConfigDNNs();
    this.updateConfigAMF();
    this.updateConfigSMF();
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
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ${dbc.database_name}.*
        TO ${dbc.user}@'%' IDENTIFIED BY '${dbc.password}'`,
      ],
      await fs.readFile(path.resolve(oai_conf.cn5gPath, "database/oai_db2.sql"), "utf8"),
      this.populateSQL(),
    ));
  }

  private *populateSQL(): Iterable<string> {
    const [mcc, mnc] = NetDef.splitPLMN(this.ctx.network.plmn);
    const servingPlmnid = `${mcc}${mnc}`;
    yield "SELECT @sqn_json:=sequenceNumber FROM AuthenticationSubscription LIMIT 1";
    yield "DELETE FROM AccessAndMobilitySubscriptionData";
    yield "DELETE FROM AuthenticationSubscription";
    yield "DELETE FROM SessionManagementSubscriptionData";
    for (const sub of this.ctx.netdef.listSubscribers()) {
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
    assert(this.ctx.network.amfs.length === 1, "support exactly 1 AMF");
    const amf = this.ctx.network.amfs[0]!;

    const c = this.c.amf!;
    c.amf_name = amf.name;
    if (!(this.c.register_nf.smf ?? this.c.register_nf.general)) {
      // SMF selection depends on SMF registration in NRF
      c.support_features_options.enable_smf_selection = false;
    }
    c.supported_integrity_algorithms = c.supported_integrity_algorithms.filter((algo) => algo !== "NIA0");

    const [mcc, mnc] = NetDef.splitPLMN(this.ctx.network.plmn);
    c.served_guami_list = [{
      mcc,
      mnc,
      amf_region_id: hexPad(amf.amfi[0], 2),
      amf_set_id: hexPad(amf.amfi[1], 3),
      amf_pointer: hexPad(amf.amfi[2], 2),
    }];
    c.plmn_support_list = [{
      mcc,
      mnc,
      tac: `0x${hexPad(this.ctx.netdef.tac, 4)}`,
      nssai: this.c.snssais,
    }];
  }

  private updateConfigSMF(): void {
    assert(this.ctx.network.smfs.length === 1, "support exactly 1 SMF");

    const c = this.c.smf!;

    const upfTpl = c.upfs[0]!;
    c.upfs = this.ctx.network.upfs.map((upf): CN5G.smf.UPF => {
      const ct = this.ctx.c.services[upf.name]!;
      return {
        ...upfTpl,
        host: ct.networks.n4!.ipv4_address,
      };
    });

    c.smf_info.sNssaiSmfInfoList = this.ctx.netdef.nssai.map((snssai): CN5G.smf.SNSSAIInfo => {
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
    // rely on hosts entry because UP is created before CP so that NRF and SMF IP are unknown
    // XXX this assumes there is only one NRF and one SMF
    this.c.nfs.nrf!.host = "nrf.br-cp";
    this.c.upf!.smfs = [{ host: "smf.br-n4" }];

    this.updateConfigDNNs();
    this.c.upf!.support_features.enable_snat = false;
    delete this.c.amf;
    delete this.c.smf;

    for (const [ct, upf] of compose.suggestNames("upf", this.ctx.network.upfs)) {
      const configPath = `up-cfg/${ct}.yaml`;
      const s = this.defineService(ct, "upf", this.c.nfs.upf!, false, configPath);
      s.devices.push("/dev/net/tun:/dev/net/tun");

      const peers = this.ctx.netdef.gatherUPFPeers(upf);
      assert.equal(peers.N9.length, 0, "N9 not supported");
      compose.setCommands(s, [
        ...NetDefDN.makeUPFRoutes(this.ctx, peers),
        ...this.makeExecCommands("upf"),
      ]);

      this.updateConfigUPF(peers);
      await this.ctx.writeFile(configPath, this.c);
    }

    NetDefDN.setDNCommands(this.ctx);
  }

  private updateConfigUPF(peers: NetDef.UPFPeers): void {
    const { sNssaiUpfInfoList } = this.c.upf!.upf_info;
    sNssaiUpfInfoList.splice(0, Infinity);
    for (const snssai of this.ctx.netdef.nssai) {
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

export async function oaiCP(ctx: NetDefComposeContext): Promise<void> {
  const b = new CPBuilder(ctx);
  await b.build();
}

export async function oaiUP(ctx: NetDefComposeContext): Promise<void> {
  const b = new UPBuilder(ctx);
  await b.build();
}
