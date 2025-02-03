import path from "node:path";

import consume from "obliterator/consume.js";
import * as shlex from "shlex";
import sql from "sql-tagged-template-literal";

import { UPGraph } from "../netdef/mod.js";
import { compose, http2Port, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { CN5G, ComposeFile } from "../types/mod.js";
import { assert, file_io, hexPad } from "../util/mod.js";
import { CN5GBuilder } from "./cn5g.js";
import { makeDnaiFqdn } from "./common.js";
import type { OAIOpts } from "./options.js";

/** Build CP functions using OAI-CN5G. */
export async function oaiCP(ctx: NetDefComposeContext, opts: OAIOpts): Promise<void> {
  const b = new CPBuilder(ctx, opts);
  await b.build();
  if (opts["oai-cn5g-nwdaf"]) {
    await new NWDAFBuilder(ctx).build();
  }
}

class CPBuilder extends CN5GBuilder {
  public async build(): Promise<void> {
    await this.loadConfig("ulcl_config.yaml", "cp-cfg/config.yaml");
    if (!this.hasPCF) {
      delete this.c.nfs.pcf;
      delete this.c.pcf;
    }

    await this.buildSQL();
    for (const [nf, nfc] of Object.entries(this.c.nfs)) {
      await this.defineService(nf, nf, nfc, true);
    }

    this.updateConfigDNNs();
    this.updateConfigAMF();
    this.updateConfigSMF();
    if (this.hasPCF) {
      await this.buildPCF();
    }
    await this.saveConfig();
  }

  private async buildSQL(): Promise<void> {
    const s = compose.mysql.define(this.ctx, "cp-sql");
    const dbc = this.c.database!;
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
      await file_io.readText(path.resolve(import.meta.dirname, "fed/database/oai_db2.sql")),
      this.populateSQL(),
    ));
  }

  private *populateSQL(): Iterable<string> {
    const servingPlmnid = `${this.plmn.mcc}${this.plmn.mnc}`;

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

    c.support_features.use_local_pcc_rules = !this.hasPCF;

    c.upfs = Array.from(netdef.listUpfs(this.ctx.network), (upf): CN5G.smf.UPF => {
      const n4 = compose.getIP(this.ctx.c, upf.name, "n4");
      const [,fqdn] = makeDnaiFqdn(upf, this.plmn);
      s.extra_hosts[fqdn] = n4;
      const smfUpf: CN5G.smf.UPF = {
        host: this.ctx.c.services[upf.name]!.image.includes("upf-vpp:") ? fqdn : n4,
        config: {
          enable_usage_reporting: false,
        },
      };

      if (!this.hasNRF) {
        smfUpf.upf_info = this.makeUPFInfo(upf.peers);
        if (upf.peers.N3.length > 0) {
          smfUpf.config!.n3_local_ipv4 = compose.getIP(this.ctx.c, upf.name, "n3");
        }
      }

      return smfUpf;
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

  private async buildPCF(): Promise<void> {
    const s = this.ctx.c.services.pcf!;
    assert(this.c.pcf);

    const { local_policy: policy } = this.c.pcf;
    policy.traffic_rules_path = "/openair-pcf/etc/traffic_rules";
    policy.pcc_rules_path = "/openair-pcf/etc/pcc_rules";
    policy.policy_decisions_path = "/openair-pcf/etc/policy_decisions";
    delete policy.qos_data_path;

    const trafficRules: CN5G.pcf.TrafficRules = {};
    const pccRules: CN5G.pcf.PccRules = {};
    const policyDecisions: CN5G.pcf.PolicyDecisions = {};

    const upg = new UPGraph(this.ctx.network);
    // check that all gNBs have the same N3 peers
    consume(netdef.listDataPathPeers.ofGnbs(this.ctx.network)[Symbol.iterator]());
    for (const dn of this.ctx.network.dataNetworks) {
      const upfPath = upg.computePath(this.ctx.network.gnbs[0]!.name, dn);
      if (!upfPath) {
        continue;
      }

      const key = `dn-${dn.dnn}`;
      trafficRules[key] = {
        routeToLocs: Array.from(
          ["access", ...upfPath, dn.dnn],
          (dnai) => ({ dnai }),
        ),
      };
      pccRules[key] = {
        flowInfos: [{ flowDescription: "permit out ip from any to assigned" }],
        precedence: 10,
        refTcData: [key],
      };
      policyDecisions[key] = {
        dnn: dn.dnn,
        pcc_rules: [key],
      };
    }

    await this.ctx.writeFile("cp-cfg/pcf-traffic-rules.yaml", trafficRules, {
      s, target: path.join(policy.traffic_rules_path, "r.yaml"),
    });
    await this.ctx.writeFile("cp-cfg/pcf-pcc-rules.yaml", pccRules, {
      s, target: path.join(policy.pcc_rules_path, "r.yaml"),
    });
    await this.ctx.writeFile("cp-cfg/pcf-policy-decisions.yaml", policyDecisions, {
      s, target: path.join(policy.policy_decisions_path, "r.yaml"),
    });
  }
}

class NWDAFBuilder {
  constructor(
      protected readonly ctx: NetDefComposeContext,
  ) {}

  private tplC!: ComposeFile;
  private ipRepl: Array<[string, string]> = [];
  private readonly mongoUrl = compose.mongo.makeUrl("nwdaf");

  public async build(): Promise<void> {
    this.tplC = await file_io.readYAML(path.join(import.meta.dirname, "nwdaf/docker-compose-nwdaf-cn-http2.yaml")) as any;
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
      Object.fromEntries(Array.from(tplS.environment, (line: string) => line.split("=") as [string, string])) :
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
        ...compose.waitReachable("AMF+SMF", [
          compose.getIP(this.ctx.c, "amf*", "cp"),
          compose.getIP(this.ctx.c, "smf*", "cp"),
        ], { mode: `tcp:${http2Port}` }),
        "msg Starting NWDAF-SBI",
        "exec ./oai-nwdaf-sbi",
      ]);
    }
    if (ms === "nbi-gateway") {
      s.environment.KONG_PROXY_LISTEN = "0.0.0.0:80";
      const kong = await file_io.readText(path.join(import.meta.dirname, "nwdaf/conf/kong.yml"));
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
