import path from "node:path";

import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import { sortBy } from "sort-by-typescript";
import sql from "sql-tagged-template-literal";
import type { Constructor } from "type-fest";

import * as compose from "../compose/mod.js";
import { importGrafanaDashboard, NetDef, type NetDefComposeContext, NetDefDN } from "../netdef-compose/mod.js";
import { networkOptions, phoenixDockerImage, updateService } from "../phoenix-compose/compose.js";
import type { N, PH } from "../types/mod.js";
import { file_io, findByName, YargsDefaults, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { ScenarioFolder } from "./folder.js";
import { IPMAP } from "./ipmap.js";
import type { NetworkFunction } from "./nf.js";

export const phoenixOptions = {
  "phoenix-cfg": {
    default: path.resolve(import.meta.dirname, "../../phoenix-repo/phoenix-src/cfg"),
    desc: "path to phoenix-src/cfg",
    group: "phoenix",
    type: "string",
  },
  "phoenix-upf-workers": {
    default: 3,
    desc: "number of worker threads in UPF",
    group: "phoenix",
    type: "number",
  },
  "phoenix-upf-single-worker-n3": {
    default: true,
    desc: "set N3 interface to single_thread mode",
    group: "phoenix",
    type: "boolean",
  },
  "phoenix-upf-single-worker-n9": {
    default: false,
    desc: "set N9 interface to single_thread mode",
    group: "phoenix",
    type: "boolean",
  },
  "phoenix-upf-single-worker-n6": {
    default: false,
    desc: "set N6 interface to single_thread mode",
    group: "phoenix",
    type: "boolean",
  },
  "phoenix-upf-xdp": {
    default: false,
    desc: "enable XDP in UPF",
    group: "phoenix",
    type: "boolean",
  },
  "phoenix-gnb-workers": {
    default: 2,
    desc: "number of worker threads in gNB",
    group: "phoenix",
    type: "number",
  },
  "phoenix-gnb-to-upf-dscp": {
    coerce(lines: readonly string[]): Array<[upf: string, dscp: number]> {
      assert(Array.isArray(lines));
      return Array.from(lines, (line: string) => {
        const tokens = line.split("=");
        assert(tokens.length === 2, `bad --phoenix-gnb-to-upf-dscp ${line}`);
        const upf = tokens[0]!.trim();
        assert.equal(compose.nameToNf(upf), "upf", `bad UPF in --phoenix-gnb-to-upf-dscp ${line}`);
        let dscp = Number.parseInt(tokens[1]!, 0); // eslint-disable-line radix
        if (Number.isNaN(dscp) && tokens[1]!.startsWith("cs")) {
          dscp = Number.parseInt(tokens[1]!.slice(2), 10) << 3;
        }
        assert(Number.isInteger(dscp) && dscp >= 0 && dscp < 64,
          `bad DSCP in --phoenix-gnb-to-upf-dscp ${line}`);
        return [upf, dscp];
      });
    },
    default: [],
    desc: "alter outer IPv4 DSCP for gNB-to-UPF traffic",
    group: "phoenix",
    nargs: 1,
    string: true,
    type: "array",
  },
  "phoenix-ue-isolated": {
    default: [""],
    desc: "allocate a reserved CPU core to UEs matching SUPI suffix",
    group: "phoenix",
    nargs: 1,
    string: true,
    type: "array",
  },
} as const satisfies YargsOptions;
type PhoenixOpts = YargsInfer<typeof phoenixOptions>;
const defaultOptions: PhoenixOpts = YargsDefaults(phoenixOptions);

function makeBuilder(cls: Constructor<PhoenixScenarioBuilder, [NetDefComposeContext, PhoenixOpts]>): (ctx: NetDefComposeContext, opts?: PhoenixOpts) => Promise<void> {
  return async (ctx, opts = defaultOptions): Promise<void> => {
    const b = new cls(ctx, opts);
    b.build();
    await b.save();
  };
}

abstract class PhoenixScenarioBuilder {
  protected abstract nfKind: string;
  protected abstract nfFilter: readonly string[];
  private hasPrometheus = false;

  constructor(
      protected readonly ctx: NetDefComposeContext,
      protected readonly opts: PhoenixOpts,
  ) {
    for (const [net, opts] of Object.entries(networkOptions)) {
      this.ctx.defineNetwork(net, opts);
    }

    const { mcc, mnc } = NetDef.splitPLMN(this.network.plmn);
    assert(mnc.length === 2, "Open5GCore only supports 2-digit MNC");
    this.sf.env.set("MCC", mcc);
    this.sf.env.set("MNC", mnc);
    this.sf.env.set("COMMAND_DISABLED", "0");
    this.sf.env.set("DISABLE_REMOTE_COMMAND", "0");
  }

  public readonly sf = new ScenarioFolder();
  protected get netdef() { return this.ctx.netdef; }
  protected get network() { return this.ctx.network; }

  public abstract build(): void;

  protected tplFile(relPath: string): string {
    return path.resolve(this.opts["phoenix-cfg"], relPath);
  }

  protected createNetworkFunction<T>(tpl: `${string}.json`, nets: readonly string[], list?: readonly T[]): Map<string, T> {
    nets = ["mgmt", ...nets];

    const tplCt = path.basename(tpl, ".json");
    const nf = compose.nameToNf(tplCt);
    const tplFile = this.tplFile(tpl);
    list ??= [{ name: nf } as any];
    const m = nf === "ue" ? compose.suggestUENames(list as ReadonlyArray<T & { supi: string }>) : compose.suggestNames(nf, list);

    for (const ct of m.keys()) {
      const s = this.ctx.defineService(ct, phoenixDockerImage, nets);
      const ctFile = `${ct}.json`;
      this.sf.createFrom(ctFile, tplFile);
      this.sf.edit(ctFile, (body) => body.replaceAll(`%${tplCt.toUpperCase()}_`, `%${ct.toUpperCase()}_`));
      this.sf.editNetworkFunction(ct, (c) => {
        c.Phoenix.Module.sort(sortBy("binaryFile"));

        const command = c.getModule("command", true);
        if (command) {
          command.config.GreetingText = `${ct.toUpperCase()}>`;
        }

        const nrfClient = c.getModule("nrf_client", true);
        if (nrfClient) {
          nrfClient.config.nf_profile.nfInstanceId = globalThis.crypto.randomUUID();
        }

        const monitoring = c.getModule("monitoring", true);
        if (monitoring) {
          this.hasPrometheus = true;
          const mgmt = s.networks.mgmt!.ipv4_address;
          monitoring.config.Prometheus = {
            listener: mgmt,
            port: 9888,
            enabled: 1,
          };

          const target = new URL("http://localhost:9888/metrics");
          target.hostname = mgmt;
          target.searchParams.set("job_name", "phoenix");
          target.searchParams.append("labels", `phnf=${s.container_name}`);
          compose.annotate(s, "prometheus_target", target.toString());
        }
      });
    }
    return m;
  }

  protected createDatabase(tpl: `${string}.sql`, db?: string): string {
    const tplName = path.basename(tpl, ".sql");
    db ??= tplName;
    const dbFile = `sql/${db}.sql`;
    this.sf.createFrom(dbFile, this.tplFile(tpl));
    if (db !== tplName) {
      this.sf.edit(dbFile, (body) => {
        body = body.replace(/^create database .*;$/im, `CREATE OR REPLACE DATABASE ${db};`);
        body = body.replaceAll(/^create database .*;$/gim, "");
        body = body.replaceAll(/^use .*;$/gim, `USE ${db};`);
        body = body.replaceAll(/^grant ([a-z,]*) on \w+\.\* to (.*);$/gim, `GRANT $1 ON ${db}.* TO $2;`);
        return body;
      });
    }
    return db;
  }

  public async save(): Promise<void> {
    this.sf.ipmap = IPMAP.fromCompose(this.ctx.c);
    for (const service of Object.values(this.ctx.c.services)) {
      if (!this.nfFilter.includes(compose.nameToNf(service.container_name))) {
        continue;
      }
      updateService(service, { cfg: `./${this.nfKind}-cfg`, sql: `./${this.nfKind}-sql` });
    }

    await this.sf.save(path.resolve(this.ctx.out, `${this.nfKind}-cfg`), path.resolve(this.ctx.out, `${this.nfKind}-sql`));

    if (this.hasPrometheus) {
      for (const entry of await file_io.fsWalk(this.tplFile("5g/prometheus"), {
        entryFilter: (entry) => entry.name.endsWith(".json"),
      })) {
        await importGrafanaDashboard(this.ctx, entry.path);
      }
    }
  }
}

class PhoenixCPBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "cp";
  protected override nfFilter = ["sql", "nrf", "udm", "ausf", "nssf", "amf", "smf"];

  public build(): void {
    this.buildSQL();
    this.buildNRF();
    this.buildUDM();
    this.buildAUSF();
    this.buildNSSF();
    this.buildAMFs();
    this.buildSMFs();
  }

  private buildSQL(): void {
    this.ctx.defineService("sql", phoenixDockerImage, ["db"]);
  }

  private buildNRF(): void {
    this.createNetworkFunction("5g/nrf.json", ["cp"]);
  }

  private buildUDM(): void {
    const { netdef } = this;
    const db = this.createDatabase("5g/sql/udm_db.sql");
    this.sf.appendSQL(db, function*() {
      yield "DELETE FROM gpsi_supi_association";
      yield "DELETE FROM supi";
      yield "DELETE FROM gpsi";
      yield "SELECT @am_json:=access_and_mobility_sub_data FROM am_data WHERE supi='0'";
      yield "DELETE FROM am_data";
      yield "SELECT @dnn_json:=json FROM dnn_configurations WHERE supi='default_data' LIMIT 1";
      yield "DELETE FROM dnn_configurations";

      for (const { supi, k, opc, subscribedNSSAI, subscribedDN } of netdef.listSubscribers()) {
        yield sql`
          INSERT supi (identity,k,amf,op,sqn,auth_type,op_is_opc,usim_type)
          VALUES (${supi},UNHEX(${k}),UNHEX(${USIM.amf}),UNHEX(${opc}),UNHEX(${USIM.sqn}),0,1,0)
          RETURNING @supi_id:=id
        `;
        yield sql`INSERT gpsi (identity) VALUES (${`msisdn-${supi}`}) RETURNING @gpsi_id:=id`;
        yield "INSERT gpsi_supi_association (gpsi_id,supi_id) VALUES (@gpsi_id,@supi_id)";

        const amPatch = {
          nssai: {
            defaultSingleNssais: subscribedNSSAI.map(({ snssai }) => NetDef.splitSNSSAI(snssai).ih),
          },
        };
        yield sql`INSERT am_data (supi,access_and_mobility_sub_data) VALUES (${supi},JSON_MERGE_PATCH(@am_json,${amPatch}))`;

        for (const { snssai, dnn } of subscribedDN) {
          const dn = netdef.findDN(dnn, snssai);
          assert(!!dn);
          const { sst } = NetDef.splitSNSSAI(snssai).ih;
          const dnnPatch = {
            pduSessionTypes: {
              defaultSessionType: dn.type.toUpperCase(),
            },
          };
          yield sql`INSERT dnn_configurations (supi,sst,dnn,json) VALUES (${supi},${sst},${dnn},JSON_MERGE_PATCH(@dnn_json,${dnnPatch}))`;
        }
      }
    });

    this.createNetworkFunction("5g/udm.json", ["db", "cp"]);
  }

  private buildAUSF(): void {
    this.createNetworkFunction("5g/ausf.json", ["cp"]);
  }

  private buildNSSF(): void {
    const { amfs } = this.netdef;
    const amfNSSAIs = new Set<string>();
    for (const amf of amfs) {
      amf.nssai.sort((a, b) => a.localeCompare(b));
      amfNSSAIs.add(amf.nssai.join(","));
    }
    if (amfNSSAIs.size <= 1) {
      return;
    }

    const db = this.createDatabase("5g_nssf/sql/nssf_db.sql");
    this.sf.appendSQL(db, function*() {
      yield "DELETE FROM snssai_nsi_mapping";
      yield "DELETE FROM nsi";
      yield "DELETE FROM snssai";
      for (const [i, amf] of amfs.entries()) {
        yield sql`INSERT nsi (nsi_id,nrf_id,target_amf_set) VALUES (${`nsi_id_${i}`},${`nrf_id_${i}`},${`${amf.amfi[1]}`}) RETURNING @nsi_id:=row_id`;
        for (const snssai of amf.nssai) {
          const { sst, sd = "" } = NetDef.splitSNSSAI(snssai).ih;
          yield sql`INSERT snssai (sst,sd) VALUES (${sst},${sd}) RETURNING @snssai_id:=row_id`;
          yield "INSERT snssai_nsi_mapping (row_id_snssai,row_id_nsi) VALUES (@snssai_id,@nsi_id)";
        }
      }
    });

    this.createNetworkFunction("5g_nssf/nssf.json", ["db", "cp"]);
  }

  private buildAMFs(): void {
    for (const [ct, amf] of this.createNetworkFunction("5g/amf.json", ["cp", "n2"], this.ctx.netdef.amfs)) {
      this.sf.editNetworkFunction(ct,
        (c) => setNrfClientSlices(c, amf.nssai),
        (c) => {
          const { config } = c.getModule("amf");
          config.id = ct;
          const [regionId, amfSetId, amfPointer] = amf.amfi;
          config.guami = {
            mcc: "%MCC",
            mnc: "%MNC",
            regionId,
            amfSetId,
            amfPointer,
          };
          config.trackingArea = [{
            mcc: "%MCC",
            mnc: "%MNC",
            taiList: [
              { tac: this.netdef.tac },
            ],
          }];
          config.hacks.enable_reroute_nas = this.sf.has("nssf.json");
        },
      );
    }
  }

  private buildSMFs(): void {
    const { network, netdef: { smfs, dataPathLinks } } = this;
    let nextTeid = 0x10000000;
    const eachTeid = Math.floor(0xE0000000 / smfs.length);
    for (const [ct, smf] of this.createNetworkFunction("5g/smf.json", ["db", "cp", "n4"], smfs)) {
      const db = this.createDatabase("5g/sql/smf_db.sql", ct);
      this.sf.appendSQL(db, function*() {
        yield "DELETE FROM dn_dns";
        yield "DELETE FROM dn_info";
        yield "DELETE FROM dn_ipv4_allocations";
        yield "DELETE FROM dnn";
        for (const { dnn, type, subnet } of network.dataNetworks) {
          yield sql`INSERT dnn (dnn) VALUES (${dnn}) RETURNING @dn_id:=dn_id`;
          if (type === "IPv4") {
            assert(!!subnet);
            const net = new Netmask(subnet);
            yield "INSERT dn_dns (dn_id,addr,ai_family) VALUES (@dn_id,'1.1.1.1',2)";
            yield sql`INSERT dn_info (dnn,network,prefix) VALUES (${dnn},${net.base},${net.bitmask})`;
          }
        }
      });

      const startTeid = nextTeid;
      nextTeid += eachTeid;
      this.sf.editNetworkFunction(ct,
        (c) => setNrfClientSlices(c, smf.nssai),
        (c) => {
          const { config } = c.getModule("smf");
          config.Database.database = db;
          config.id = ct;
          config.mtu = 1456;
          config.startTeid = startTeid;
        },
        (c) => {
          const { config } = c.getModule("sdn_routing_topology");
          config.Topology.Link = dataPathLinks.flatMap(({ a: nodeA, b: nodeB, cost }) => {
            const typeA = this.determineDataPathNodeType(nodeA);
            const typeB = this.determineDataPathNodeType(nodeB);
            if (smf.nssai) {
              const dn = typeA === "DNN" ? nodeA as N.DataNetworkID : typeB === "DNN" ? nodeB as N.DataNetworkID : undefined;
              if (dn && !smf.nssai.includes(dn.snssai)) {
                return [];
              }
            }
            return {
              weight: cost,
              Node_A: this.makeDataPathTopoNode(nodeA, typeA, typeB),
              Node_B: this.makeDataPathTopoNode(nodeB, typeB, typeA),
            };
          });
        },
        (c) => {
          const { config } = c.getModule("pfcp");
          config.Associations.Peer = network.upfs.map((upf): PH.pfcp.Acceptor => ({
            type: "udp",
            port: 8805,
            bind: IPMAP.formatEnv(upf.name, "n4"),
          }));
        },
      );
    }
  }

  private determineDataPathNodeType(node: string | N.DataNetworkID): PH.sdn_routing_topology.Node["type"] {
    if (typeof node !== "string") {
      return "DNN";
    }
    if (findByName(node, this.netdef.gnbs) !== undefined) {
      return "gNodeB";
    }
    if (findByName(node, this.network.upfs) !== undefined) {
      return "UPF";
    }
    throw new Error(`data path node ${node} not found`);
  }

  private makeDataPathTopoNode(
      node: string | N.DataNetworkID,
      nodeType: PH.sdn_routing_topology.Node["type"],
      peerType: PH.sdn_routing_topology.Node["type"],
  ): PH.sdn_routing_topology.Node {
    switch (nodeType) {
      case "DNN": {
        assert(peerType === "UPF");
        return {
          type: "DNN",
          id: (node as N.DataNetworkID).dnn,
          ip: "255.255.255.255",
        };
      }
      case "gNodeB": {
        assert(peerType === "UPF");
        const gnb = findByName(node as string, this.netdef.gnbs)!;
        return {
          type: "gNodeB",
          id: gnb.nci.gnb,
          ip: "255.255.255.255",
        };
      }
    }

    const upf = findByName(node as string, this.network.upfs)!;
    return {
      type: "UPF",
      id: IPMAP.formatEnv(upf.name, "n4"),
      ip: IPMAP.formatEnv(upf.name, {
        DNN: "n6",
        gNodeB: "n3",
        UPF: "n9",
      }[peerType]),
    };
  }
}
/** Build CP functions using Open5GCore. */
export const phoenixCP = makeBuilder(PhoenixCPBuilder);

class PhoenixUPBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "up";
  protected override nfFilter = ["upf", "dn", "igw", "hostnat"];

  public build(): void {
    NetDefDN.defineDNServices(this.ctx);
    this.buildUPFs();
    NetDefDN.setDNCommands(this.ctx);
  }

  private buildUPFs(): void {
    const nWorkers = this.opts["phoenix-upf-workers"];
    assert(nWorkers <= 8, "pfcp.so allows up to 8 threads");

    for (const [ct, upf] of this.createNetworkFunction("5g/upf1.json", ["n3", "n4", "n6", "n9"], this.ctx.network.upfs)) {
      const s = this.ctx.c.services[ct]!;
      compose.annotate(s, "cpus", nWorkers);

      const peers = this.netdef.gatherUPFPeers(upf);
      assert(peers.N6Ethernet.length <= 1, "UPF only supports one Ethernet DN");
      assert(peers.N6IPv6.length === 0, "UPF does not supports IPv6 DN");

      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("pfcp");
        assert(config.mode === "UP");
        assert(config.data_plane_mode === "integrated");
        assert(config.DataPlane.xdp);

        let nThreadPoolWorkers = nWorkers;
        let needThreadPool = false;
        const getInterfaceMode = (intf: "n3" | "n9" | "n6"): PH.pfcp.Interface["mode"] => {
          if (this.opts[`phoenix-upf-single-worker-${intf}`]) {
            --nThreadPoolWorkers;
            return "single_thread";
          }
          needThreadPool = true;
          return "thread_pool";
        };

        config.ethernet_session_identifier = peers.N6Ethernet[0]?.dnn;
        config.DataPlane.threads = nWorkers;
        config.DataPlane.interfaces = [];
        config.DataPlane.xdp.interfaces = [];
        if (peers.N3.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n3_n9",
            name: "n3",
            bind_ip: IPMAP.formatEnv(ct, "n3"),
            mode: getInterfaceMode("n3"),
          });
          config.DataPlane.xdp.interfaces.push({
            type: "n3_n9",
            name: "n3",
          });
        }
        if (peers.N9.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n3_n9",
            name: "n9",
            bind_ip: IPMAP.formatEnv(ct, "n9"),
            mode: getInterfaceMode("n9"),
          });
          config.DataPlane.xdp.interfaces.push({
            type: "n3_n9",
            name: "n9",
          });
        }
        if (peers.N6IPv4.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n6_l3",
            name: "n6_tun",
            bind_ip: IPMAP.formatEnv(ct, "n6"),
            mode: getInterfaceMode("n6"),
          });
          config.DataPlane.xdp.interfaces.push({
            type: "n6_l3",
            name: "n6_tun",
          });
        }
        if (peers.N6Ethernet.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n6_l2",
            name: "n6_tap",
            mode: getInterfaceMode("n6"),
          });
        }

        assert(config.DataPlane.interfaces.length <= 8, "pfcp.so allows up to 8 interfaces");
        if (this.opts["phoenix-upf-xdp"]) {
          s.cap_add.push("BPF", "SYS_ADMIN");
        } else {
          delete config.DataPlane.xdp;
        }
        assert(needThreadPool ? nThreadPoolWorkers > 0 : nThreadPoolWorkers >= 0,
          "insufficient thread_pool workers after satisfying single_thread interfaces");

        config.hacks.qfi = 1;
      });

      this.sf.initCommands.set(ct, [
        ...(peers.N6IPv4.length > 0 ? [
          "ip tuntap add mode tun user root name n6_tun",
          "ip link set n6_tun up",
        ] : []),
        ...(peers.N6Ethernet.length > 0 ? [
          "ip link add name br-eth type bridge",
          "ip link set br-eth up",
          "ip tuntap add mode tap user root name n6_tap",
          "ip link set n6_tap up master br-eth",
        ] : []),
        ...NetDefDN.makeUPFRoutes(this.ctx, peers, { msg: false }),
      ]);

      for (const { subnet } of peers.N6IPv4) {
        this.sf.routes.set(ct, { dest: new Netmask(subnet!), dev: "n6_tun" });
      }
    }
  }
}
/** Build UP functions using Open5GCore as UPF. */
export const phoenixUP = makeBuilder(PhoenixUPBuilder);

class PhoenixRANBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "ran";
  protected override nfFilter = ["gnb", "ue"];

  public build(): void {
    this.buildGNBs();
    this.buildUEs();
  }

  private buildGNBs(): void {
    const sliceKeys = ["slice", "slice2"] as const;
    const slices = this.netdef.nssai.map((snssai) => NetDef.splitSNSSAI(snssai).ih);
    assert(slices.length <= sliceKeys.length, `gNB allows up to ${sliceKeys.length} slices`);
    const nWorkers = this.opts["phoenix-gnb-workers"];

    for (const [ct, gnb] of this.createNetworkFunction("5g/gnb1.json", ["air", "n2", "n3"], this.ctx.netdef.gnbs)) {
      const s = this.ctx.c.services[ct]!;
      compose.annotate(s, "cpus", nWorkers);
      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("gnb");
        delete config.amf_addr;
        delete config.amf_port;
        config.amf_list = this.netdef.amfs.map((amf): PH.gnb.AMF => ({
          ngc_addr: IPMAP.formatEnv(amf.name, "n2"),
          ngc_sctp_port: 38412,
        }));
        config.mcc = "%MCC";
        config.mnc = "%MNC";
        config.gnb_id = gnb.nci.gnb;
        config.cell_id = gnb.nci.nci;
        config.tac = this.netdef.tac;

        for (const [i, k] of sliceKeys.entries()) {
          if (slices.length > i) {
            config[k] = slices[i];
          } else {
            delete config[k]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
          }
        }

        config.forwarding_worker = nWorkers;
      });
      this.sf.initCommands.set(ct, [
        "iptables -I OUTPUT -p icmp --icmp-type destination-unreachable -j DROP",
        ...this.makeGnbDscpCommands(ct),
      ]);
    }
  }

  private *makeGnbDscpCommands(gnb: string): Iterable<string> {
    for (const [upf, dscp] of this.opts["phoenix-gnb-to-upf-dscp"]) {
      const s = this.ctx.c.services[upf];
      assert(!!s, `UPF ${upf} in --phoenix-gnb-to-upf-dscp does not exist`);
      yield `iptables -t mangle -A OUTPUT -s ${IPMAP.formatEnv(gnb, "n3", "$")
      } -d ${IPMAP.formatEnv(upf, "n3", "$")} -j DSCP --set-dscp ${dscp}`;
    }
  }

  private buildUEs(): void {
    const { "phoenix-ue-isolated": isolated } = this.opts;
    for (const [ct, sub] of this.createNetworkFunction("5g/ue1.json", ["air"], this.ctx.netdef.listSubscribers())) {
      const s = this.ctx.c.services[ct]!;
      compose.annotate(s, "cpus", isolated.some((suffix) => sub.supi.endsWith(suffix)) ? 1 : 0);
      compose.annotate(s, "ue_supi", sub.supi);
      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("ue_5g_nas_only");
        config.usim = {
          supi: sub.supi,
          k: sub.k,
          amf: USIM.amf,
          opc: sub.opc,
          start_sqn: USIM.sqn,
        };
        delete config["usim-test-vector19"];

        config.dn_list = sub.requestedDN.map(({ snssai, dnn }): PH.ue_5g_nas_only.DN => {
          const dn = this.netdef.findDN(dnn, snssai);
          assert(dn && dn.type !== "IPv6");
          return {
            dnn: dn.dnn,
            dn_type: dn.type,
          };
        });
        config.DefaultNetwork.dnn = config.dn_list[0]?.dnn ?? "default";

        config.Cell = sub.gnbs.map((name): PH.ue_5g_nas_only.Cell => {
          const ip = IPMAP.formatEnv(name, "air");
          const gnb = findByName(name, this.netdef.gnbs);
          assert(!!gnb);
          return {
            cell_id: gnb.nci.nci,
            mcc: "%MCC",
            mnc: "%MNC",
            gnb_cp_addr: ip,
            gnb_up_addr: ip,
            gnb_port: 10000,
          };
        });

        config.ip_tool = "/opt/phoenix/cfg/5g/ue-tunnel-mgmt.sh";
      });
    }
  }
}
/** Build RAN functions using Open5GCore RAN simulators. */
export const phoenixRAN = makeBuilder(PhoenixRANBuilder);

function setNrfClientSlices(c: NetworkFunction, nssai: readonly N.SNSSAI[]): void {
  const { config } = c.getModule("nrf_client");
  config.nf_profile.sNssais = nssai.map((snssai) => NetDef.splitSNSSAI(snssai).ih);
}

const USIM = { sqn: "000000000001", amf: "8000" } as const;
