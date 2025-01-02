import path from "node:path";

import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";
import sql from "sql-tagged-template-literal";

import { compose, http2Port, makeUPFRoutes, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { CN5G, ComposeFile, ComposeService, N } from "../types/mod.js";
import { assert, file_io, hexPad } from "../util/mod.js";
import * as oai_conf from "./conf.js";
import type { OAIOpts } from "./options.js";

const iproute2Available = new Set(["upf"]); // images known to have iproute2 package

abstract class CN5GBuilder {
  constructor(
      protected readonly ctx: NetDefComposeContext,
      protected readonly opts: OAIOpts,
  ) {}

  protected c!: CN5G.Config;

  protected async loadTemplateConfig(): Promise<void> {
    this.c = await oai_conf.loadCN5G();
    this.c.register_nf.general = this.opts["oai-cn5g-nrf"];
    if (!this.c.register_nf.general) {
      delete this.c.nfs.nrf;
    }
  }

  protected async defineService(ct: string, nf: string, c: CN5G.NF, db: boolean, configPath: string): Promise<ComposeService> {
    const nets: Array<[net: string, intf: CN5G.NF.Interface | undefined]> = [];
    if (db) {
      nets.push(["db", undefined]);
    }
    for (const [key, intf] of Object.entries(c)) {
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

    c.host = compose.getIP(s, "cp");

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
    this.c.snssais = Array.from(netdef.listNssai(this.ctx.network), (snssai) => netdef.splitSNSSAI(snssai).ih);
    this.c.dnns = this.ctx.network.dataNetworks.map((dn): CN5G.DNN => ({
      dnn: dn.dnn,
      pdu_session_type: "IPV4",
      ipv4_subnet: dn.subnet,
    }));
  }

  protected makeUPFInfo(peers: netdef.UPFPeers): CN5G.upf.UPFInfo {
    const info: CN5G.upf.UPFInfo = {
      sNssaiUpfInfoList: [],
    };
    for (const snssai of netdef.listNssai(this.ctx.network)) {
      const sPeers = peers.N6IPv4.filter((peer) => peer.snssai === snssai);
      if (sPeers.length === 0) {
        continue;
      }

      const item: CN5G.upf.SNSSAIInfo = {
        sNssai: netdef.splitSNSSAI(snssai).ih,
        dnnUpfInfoList: sPeers.map(({ dnn }) => ({ dnn })),
      };
      info.sNssaiUpfInfoList.push(item);
    }
    return info;
  }
}

class CPBuilder extends CN5GBuilder {
  public async build(): Promise<void> {
    await this.loadTemplateConfig();
    delete this.c.nfs.upf;
    delete this.c.upf;

    await this.buildSQL();
    const configPath = "cp-cfg/config.yaml";
    for (const [nf, c] of Object.entries(this.c.nfs)) {
      await this.defineService(nf, nf, c, true, configPath);
    }

    this.updateConfigDNNs();
    this.updateConfigAMF();
    this.updateConfigSMF();
    await this.ctx.writeFile(configPath, this.c);
  }

  private async buildSQL(): Promise<void> {
    const s = compose.mysql.define(this.ctx, "cp-sql");
    const dbc = this.c.database;
    dbc.host = compose.getIP(s, "db");
    dbc.user = "oai";
    dbc.password = "oai";
    dbc.database_name = "oai_db";

    await this.ctx.writeFile("cp-sql/oai_db.sql", compose.mysql.join(
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
    const { mcc, mnc } = netdef.splitPLMN(this.ctx.network.plmn);
    const servingPlmnid = `${mcc}${mnc}`;

    yield "SELECT @sqn_json:=sequenceNumber FROM AuthenticationSubscription LIMIT 1";
    yield "DELETE FROM AuthenticationSubscription";
    yield "DELETE FROM AccessAndMobilitySubscriptionData";
    yield sql`SELECT @dnn_json_tpl:=JSON_EXTRACT(dnnConfigurations,${"$.default"}) FROM SessionManagementSubscriptionData LIMIT 1`;
    yield "DELETE FROM SessionManagementSubscriptionData";

    for (const { supi, k, opc, subscribedNSSAI } of netdef.listSubscribers(this.ctx.network)) {
      yield sql`
        INSERT AuthenticationSubscription (ueid,authenticationMethod,encPermanentKey,protectionParameterId,sequenceNumber,authenticationManagementField,algorithmId,encOpcKey,encTopcKey,vectorGenerationInHss,n5gcAuthMethod,rgAuthenticationInd,supi)
        VALUES (${supi},'5G_AKA',${k},${k},@sqn_json,'8000','milenage',${opc},NULL,NULL,NULL,NULL,${supi})
      `;

      const nssai = {
        defaultSingleNssais: [] as CN5G.SNSSAI[],
      };
      for (const { snssai, dnns } of subscribedNSSAI) {
        const snssaiJ = netdef.splitSNSSAI(snssai).ih;
        nssai.defaultSingleNssais.push(snssaiJ);
        yield sql`SET @dnn_json=${{}}`;
        for (const dnn of dnns) {
          const { sessionType, fiveQi, fiveQiPriorityLevel, arpLevel, ambr } = netdef.findDN(this.ctx.network, dnn, snssai);
          yield sql`SET @dnn_json=JSON_INSERT(@dnn_json,${`$.${dnn}`},JSON_MERGE_PATCH(@dnn_json_tpl,${{
            pduSessionTypes: { defaultSessionType: sessionType },
            "5gQosProfile": {
              "5qi": fiveQi,
              priorityLevel: fiveQiPriorityLevel,
              arp: { priorityLevel: arpLevel },
            },
            sessionAmbr: ambr,
            staticIpAddress: [],
          }}))`;
        }
        yield sql`
          INSERT SessionManagementSubscriptionData (ueid,servingPlmnid,singleNssai,dnnConfigurations)
          VALUES (${supi},${servingPlmnid},${snssaiJ},@dnn_json)
        `;
      }

      yield sql`
        INSERT AccessAndMobilitySubscriptionData (ueid,servingPlmnid,nssai)
        VALUES (${supi},${servingPlmnid},${nssai})
      `;
    }
  }

  private updateConfigAMF(): void {
    const amfs = netdef.listAmfs(this.ctx.network);
    assert(amfs.length === 1, "support exactly 1 AMF");
    const amf = amfs[0]!;

    const c = this.c.amf!;
    c.amf_name = amf.name;
    if (!(this.c.register_nf.smf ?? this.c.register_nf.general)) {
      // SMF selection depends on SMF registration in NRF
      c.support_features_options.enable_smf_selection = false;
    }
    c.supported_integrity_algorithms = c.supported_integrity_algorithms.filter((algo) => algo !== "NIA0");

    const plmn = netdef.splitPLMN(this.ctx.network.plmn);
    c.served_guami_list = [{
      ...plmn,
      amf_region_id: hexPad(amf.amfi[0], 2),
      amf_set_id: hexPad(amf.amfi[1], 3),
      amf_pointer: hexPad(amf.amfi[2], 2),
    }];
    c.plmn_support_list = [{
      ...plmn,
      tac: `0x${this.ctx.network.tac.slice(2, 6)}`,
      nssai: this.c.snssais,
    }];
  }

  private updateConfigSMF(): void {
    const smfs = netdef.listSmfs(this.ctx.network);
    assert(smfs.length === 1, "support exactly 1 SMF");

    const s = this.ctx.c.services.smf!;
    const c = this.c.smf!;

    const upfTpl = c.upfs[0]!;
    c.upfs = this.ctx.network.upfs.map((upf): CN5G.smf.UPF => {
      const upfService = this.ctx.c.services[upf.name]!;
      const host = compose.getIP(upfService, "n4");
      s.extra_hosts[`${upf.name}.5gdeploy.oai`] = host; // SMF would attempt RDNS lookup
      const upfCfg: CN5G.smf.UPF = { ...upfTpl, host };
      if (!this.opts["oai-cn5g-nrf"]) {
        const peers = netdef.gatherUPFPeers(this.ctx.network, upf);
        upfCfg.upf_info = this.makeUPFInfo(peers);
        upfCfg.config = {
          ...upfCfg.config,
          n3_local_ipv4: compose.getIP(upfService, "n3"),
        };
      }
      return upfCfg;
    });

    c.smf_info.sNssaiSmfInfoList = Array.from(netdef.listNssai(this.ctx.network), (snssai): CN5G.smf.SNSSAIInfo => {
      const dataNetworks = this.ctx.network.dataNetworks.filter((dn) => dn.snssai === snssai);
      return {
        sNssai: netdef.splitSNSSAI(snssai).ih,
        dnnSmfInfoList: dataNetworks.map(({ dnn }) => ({ dnn })),
      };
    });

    const localSubscriptionTpl = c.local_subscription_infos[0]!;
    c.local_subscription_infos = this.ctx.network.dataNetworks.map((dn): CN5G.smf.LocalSubscription => ({
      ...localSubscriptionTpl,
      single_nssai: netdef.splitSNSSAI(dn.snssai).ih,
      dnn: dn.dnn,
    }));
  }
}

class NWDAFBuilder extends CN5GBuilder {
  declare protected c: never;
  private tplC!: ComposeFile;
  private ipRepl: Array<[string, string]> = [];
  private readonly mongoUrl = compose.mongo.makeUrl("nwdaf");

  public async build(): Promise<void> {
    this.tplC = await file_io.readYAML(path.join(oai_conf.composePath, "nwdaf/docker-compose-nwdaf-cn-http2.yaml")) as any;
    this.ipRepl.push(
      ["192.168.70.132", compose.getIP(this.ctx.c, "amf*", "cp")],
      ["192.168.70.133", compose.getIP(this.ctx.c, "smf*", "cp")],
    );

    compose.mongo.define(this.ctx, { ct: "nwdaf_database", net: "nwdafdb", mongoUrl: this.mongoUrl });
    for (const ms of ["sbi", "engine", "engine-ads", "nbi-analytics", "nbi-events", "nbi-ml", "nbi-gateway"]) {
      await this.buildMicroservice(ms);
    }
    this.buildCLI();
  }

  private async buildMicroservice(ms: string): Promise<void> {
    const tplS = this.tplC.services[`oai-nwdaf-${ms}`];
    assert(!!tplS);
    const tplEnv = Array.isArray(tplS.environment) ?
      Object.fromEntries(Array.from(tplS.environment, (line) => line.split("=") as [string, string])) :
      tplS.environment;

    const ct = `nwdaf_${ms.replaceAll("-", "")}`;
    const image = tplS.image.replace(/^oai-nwdaf-/, "5gdeploy.localhost/oai-nwdaf-");
    const nets: Record<string, string> = {
      nwdaf: "nwdaf_net",
    };
    if (ms === "sbi") {
      nets.cp = "public_net";
    }
    if (tplEnv.MONGODB_URI) {
      nets.nwdafdb = "";
    }
    const s = this.ctx.defineService(ct, image, Object.keys(nets));
    for (const [netR, netT] of Object.entries(nets)) {
      if (!netT) {
        continue;
      }
      this.ipRepl.push([
        tplS.networks[netT]!.ipv4_address, // cannot use compose.getIP() because it's not in annotations
        compose.getIP(s, netR),
      ]);
    }

    for (const [key, value] of Object.entries(tplEnv)) {
      s.environment[key] = this.replaceIPs(key, value);
    }
    if ("nwdafdb" in nets) {
      s.depends_on.nwdaf_database = { condition: "service_started" };
    }
    if (ms === "sbi") {
      compose.setCommands(s, [
        ...compose.waitReachable("AMF and SMF", [
          compose.getIP(this.ctx.c, "amf*", "cp"),
          compose.getIP(this.ctx.c, "smf*", "cp"),
        ], { mode: `tcp:${http2Port}` }),
        "msg Starting NWDAF-SBI",
        "exec ./oai-nwdaf-sbi",
      ]);
    }
    if (ms === "nbi-gateway") {
      s.environment.KONG_PROXY_LISTEN = "0.0.0.0:80";
      const kong = await file_io.readText(path.join(oai_conf.composePath, "nwdaf/conf/kong.yml"));
      await this.ctx.writeFile("cp-cfg/nbi-gateway.yaml", this.replaceIPs("", kong), {
        s,
        target: "/kong/declarative/kong.yml",
      });
    }
  }

  private buildCLI(): void {
    const s = this.ctx.defineService("nwdaf_cli", "5gdeploy.localhost/oai-nwdaf-cli", ["nwdaf"]);
    s.extra_hosts["oai-nwdaf-nbi-gateway"] = compose.getIP(this.ctx.c, "nwdaf_nbigateway", "nwdaf");

    const nu = new URL("http://127.0.0.1:3000/notification");
    nu.hostname = compose.getIP(s, "nwdaf");

    compose.setCommands(s, [
      "for F in examples/subscriptions/*.json; do",
      `  jq --arg NU ${shlex.quote(nu.href)} '.notificationURI=$NU' $F | sponge $F`,
      "done",
      "tail -f",
    ], { shell: "ash" });
  }

  private replaceIPs(key: string, value: string): string {
    switch (key) {
      case "MONGODB_URI": {
        return new URL("/", this.mongoUrl).toString();
      }
      case "MONGODB_DATABASE_NAME": {
        return this.mongoUrl.pathname.slice(1);
      }
    }

    for (const [s, r] of this.ipRepl) {
      value = value.replaceAll(`//${s}:`, `//${r}:`);
    }
    value = value.replaceAll(/\b8080\b/g, `${http2Port}`);
    return value;
  }
}

/** Build CP functions using OAI-CN5G. */
export async function oaiCP(ctx: NetDefComposeContext, opts: OAIOpts): Promise<void> {
  const b = new CPBuilder(ctx, opts);
  await b.build();
  if (opts["oai-cn5g-nwdaf"]) {
    await new NWDAFBuilder(ctx, opts).build();
  }
}

class UPBuilder extends CN5GBuilder {
  public async build(upf: N.UPF): Promise<void> {
    await this.loadTemplateConfig();
    for (const [nf, c] of Object.entries(this.c.nfs)) {
      if (["nrf", "smf", "upf"].includes(nf)) {
        c.sbi.port = http2Port;
      } else {
        delete this.c.nfs[nf as CN5G.NFName]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
      }
    }
    delete this.c.amf;
    delete this.c.smf;

    const ct = upf.name;
    const configPath = `up-cfg/${ct}.yaml`;
    const s = await this.defineService(ct, "upf", this.c.nfs.upf!, false, configPath);
    compose.annotate(s, "cpus", this.opts["oai-upf-workers"]);
    s.devices.push("/dev/net/tun:/dev/net/tun");
    if (this.opts["oai-upf-bpf"]) {
      s.cap_add.push("BPF", "SYS_ADMIN", "SYS_RESOURCE");
    }

    const peers = netdef.gatherUPFPeers(this.ctx.network, upf);
    assert(peers.N9.length === 0, "N9 not supported");
    compose.setCommands(s, this.makeExecCommands(s, "upf", makeUPFRoutes(this.ctx, peers)));

    this.ctx.finalize.push(async () => {
      this.updateConfigUPF(peers); // depends on known NRF and SMF IPs
      await this.ctx.writeFile(configPath, this.c);
    });
  }

  private updateConfigUPF(peers: netdef.UPFPeers): void {
    if (this.c.nfs.nrf) {
      this.c.nfs.nrf.host = compose.getIP(this.ctx.c, "nrf", "cp");
    }
    this.c.upf!.smfs = Array.from(
      compose.listByNf(this.ctx.c, "smf"),
      (smf) => ({ host: compose.getIP(smf, "n4") }),
    );
    this.c.nfs.smf!.host = this.c.upf!.smfs[0]!.host;

    this.updateConfigDNNs();
    this.c.upf!.support_features.enable_bpf_datapath = this.opts["oai-upf-bpf"];
    this.c.upf!.support_features.enable_snat = false;
    this.c.upf!.upf_info = this.makeUPFInfo(peers);
  }
}

/** Build oai-cn5g-upf. */
export async function oaiUP(ctx: NetDefComposeContext, upf: N.UPF, opts: OAIOpts): Promise<void> {
  const b = new UPBuilder(ctx, opts);
  await b.build(upf);
}
