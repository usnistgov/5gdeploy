import path from "node:path";

import { Netmask } from "netmask";
import consume from "obliterator/consume.js";
import { sortBy } from "sort-by-typescript";
import sql from "sql-tagged-template-literal";
import assert from "tiny-invariant";
import type { Constructor } from "type-fest";

import * as compose from "../compose/mod.js";
import { applyQoS, importGrafanaDashboard, NetDef, type NetDefComposeContext, NetDefDN, setProcessExporterRule } from "../netdef-compose/mod.js";
import type { ComposeService, N, PH } from "../types/mod.js";
import { file_io, findByName, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { ScenarioFolder } from "./folder.js";
import type { NetworkFunction } from "./nf.js";

const phoenixDockerImage = "5gdeploy.localhost/phoenix";
const cfgdir = "/opt/phoenix/cfg/5gdeploy";

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
  "phoenix-ue-isolated": {
    array: true,
    default: [""],
    desc: "allocate a reserved CPU core to UEs matching SUPI suffix",
    group: "phoenix",
    nargs: 1,
    type: "string",
  },
} as const satisfies YargsOptions;
type PhoenixOpts = YargsInfer<typeof phoenixOptions>;

function makeBuilder(cls: Constructor<PhoenixScenarioBuilder, [NetDefComposeContext, PhoenixOpts]>): (ctx: NetDefComposeContext, opts: PhoenixOpts) => Promise<void> {
  return async (ctx, opts): Promise<void> => {
    const b = new cls(ctx, opts);
    b.build();
    await b.save();
  };
}

abstract class PhoenixScenarioBuilder {
  protected abstract nfKind: string;
  protected abstract nfFilter: readonly string[];
  protected readonly plmn: PH.PLMNID;
  private hasPrometheus = false;

  constructor(
      protected readonly ctx: NetDefComposeContext,
      protected readonly opts: PhoenixOpts,
  ) {
    this.ctx.defineNetwork("mgmt", { wantNAT: true });
    this.ctx.defineNetwork("air", { mtu: 1470 });
    this.ctx.defineNetwork("n6", { mtu: 1456 });

    this.plmn = NetDef.splitPLMN(this.network.plmn);
    assert(this.plmn.mnc.length === 2, "Open5GCore only supports 2-digit MNC");
  }

  public readonly sf = new ScenarioFolder();
  protected get netdef() { return this.ctx.netdef; }
  protected get network() { return this.ctx.network; }

  public abstract build(): void;

  protected tplFile(relPath: string): string {
    return path.resolve(this.opts["phoenix-cfg"], relPath);
  }

  protected *createNetworkFunctions<T>(
      tpl: `${string}.json`,
      nets: readonly string[],
      list?: readonly T[],
  ): IterableIterator<[ct: string, item: T, s: ComposeService]> {
    nets = ["mgmt", ...nets];

    const tplCt = path.basename(tpl, ".json");
    const nf = compose.nameToNf(tplCt);
    const tplFile = this.tplFile(tpl);
    list ??= [{ name: nf } as any];

    for (const [ct, item] of nf === "ue" ?
      compose.suggestUENames(list as ReadonlyArray<T & { supi: string }>) :
      compose.suggestNames(nf, list)
    ) {
      const s = this.createNetworkFunction(ct, nets, tplCt, tplFile);
      yield [ct, item, s];
    }
  }

  private createNetworkFunction(ct: string, nets: readonly string[], tplCt: string, tplFile: string): ComposeService {
    const s = this.ctx.defineService(ct, phoenixDockerImage, nets);
    s.working_dir = cfgdir;
    s.stdin_open = true;
    s.tty = true;
    s.cap_add.push("NET_ADMIN");
    s.sysctls["net.ipv4.ip_forward"] = 1;
    s.sysctls["net.ipv6.conf.all.disable_ipv6"] = 1;
    s.volumes.push({
      type: "bind",
      source: `./${this.nfKind}-cfg`,
      target: cfgdir,
      read_only: true,
    });
    compose.setCommands(s, [
      ...compose.renameNetifs(s, { pipeworkWait: true, disableTxOffload: true }),
      `/entrypoint.sh ${s.container_name}`,
    ]);

    const ctFile = `${ct}.json`;
    this.sf.createFrom(ctFile, tplFile);

    this.sf.edit(ctFile, (body) => body.replaceAll(/"%([A-Z\d]+)_([A-Z\d]+)_IP"/g, (m, mCt: string, mNet: string) => {
      void m;
      mCt = mCt.toLowerCase();
      const service = mCt === tplCt ? s : this.ctx.c.services[mCt];
      mNet = mNet.toLowerCase();
      return JSON.stringify(service?.networks[mNet]?.ipv4_address ?? "unresolved-ip-address");
    }));

    this.sf.editNetworkFunction(ct, (c) => {
      c.Phoenix.Module.sort(sortBy("binaryFile"));

      for (const binaryName of ["httpd", "json_rpc", "remote_command", "rest_api"] as const) {
        const module = c.getModule(binaryName, true);
        if (module) {
          delete module.ignore;
        }
      }

      const command = c.getModule("command", true);
      if (command) {
        command.config.DisablePrompt = false;
        command.config.GreetingText = `${ct.toUpperCase()}>`;
      }

      const nrfClient = c.getModule("nrf_client", true);
      if (nrfClient) {
        nrfClient.config.nf_profile.plmnList = [this.plmn];
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

    return s;
  }

  protected buildSQL(): void {
    const s = this.ctx.defineService("sql", compose.mysql.image, ["db"]);
    compose.mysql.init(s, `./${this.nfKind}-sql`);
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
    for (const service of Object.values(this.ctx.c.services)) {
      if (!this.nfFilter.includes(compose.nameToNf(service.container_name))) {
        continue;
      }
    }

    await this.sf.save(path.resolve(this.ctx.out, `${this.nfKind}-cfg`), path.resolve(this.ctx.out, `${this.nfKind}-sql`));

    if (this.hasPrometheus) {
      await this.updatePrometheus();
    }
  }

  private async updatePrometheus(): Promise<void> {
    setProcessExporterRule(this.ctx, "phoenix",
      [{
        comm: ["phoenix"],
        cmdline: [/-j [\w/]+\/(?<NF>\w+)\.json/],
        name: "phoenix:{{.Matches.NF}}",
      }],
      [{
        source_labels: ["groupname"],
        regex: /phoenix:(\w+)/,
        target_label: "phnf",
      }],
    );

    for (const entry of await file_io.fsWalk(this.tplFile("5g/prometheus"), {
      entryFilter: (entry) => entry.name.endsWith(".json"),
    })) {
      await importGrafanaDashboard(this.ctx, entry.path);
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

  private buildNRF(): void {
    consume(this.createNetworkFunctions("5g/nrf.json", ["cp"]));
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

    consume(this.createNetworkFunctions("5g/udm.json", ["db", "cp"]));
  }

  private buildAUSF(): void {
    consume(this.createNetworkFunctions("5g/ausf.json", ["cp"]));
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

    consume(this.createNetworkFunctions("5g_nssf/nssf.json", ["db", "cp"]));
  }

  private buildAMFs(): void {
    for (const [ct, amf] of this.createNetworkFunctions("5g/amf.json", ["cp", "n2"], this.ctx.netdef.amfs)) {
      this.sf.editNetworkFunction(ct,
        (c) => setNrfClientSlices(c, amf.nssai),
        (c) => {
          const { config } = c.getModule("amf");
          config.id = ct;
          const [regionId, amfSetId, amfPointer] = amf.amfi;
          config.guami = {
            ...this.plmn,
            regionId,
            amfSetId,
            amfPointer,
          };
          config.trackingArea = [{
            ...this.plmn,
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
    for (const [ct, smf] of this.createNetworkFunctions("5g/smf.json", ["db", "cp", "n4"], smfs)) {
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
          Object.assign(config, this.plmn);
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
          config.Associations.Peer = Array.from(this.ctx.gatherIPs("upf", "n4"), (ip) => ({
            type: "udp",
            port: 8805,
            bind: ip,
          }));
          config.Associations.heartbeat_interval = 5;
          config.Associations.max_heartbeat_retries = 2;
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
      case "UPF": {
        const upf = this.ctx.c.services[node as string]!;
        return {
          type: "UPF",
          id: upf.networks.n4!.ipv4_address,
          ip: upf.networks[{
            DNN: "n6",
            gNodeB: "n3",
            UPF: "n9",
          }[peerType]]!.ipv4_address,
        };
      }
    }
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

    for (const [ct, upf, s] of this.createNetworkFunctions("5g/upf1.json", ["n3", "n4", "n6", "n9"], this.ctx.network.upfs)) {
      compose.annotate(s, "cpus", nWorkers);
      for (const netif of ["all", "default"]) {
        s.sysctls[`net.ipv4.conf.${netif}.accept_local`] = 1;
        s.sysctls[`net.ipv4.conf.${netif}.rp_filter`] = 2;
      }
      s.devices.push("/dev/net/tun:/dev/net/tun");

      const peers = this.netdef.gatherUPFPeers(upf);
      assert(peers.N6Ethernet.length <= 1, "UPF only supports one Ethernet DN");
      assert(peers.N6IPv6.length === 0, "UPF does not support IPv6 DN");

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
            bind_ip: s.networks.n3!.ipv4_address,
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
            bind_ip: s.networks.n9!.ipv4_address,
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
            bind_ip: s.networks.n6!.ipv4_address,
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
        ...applyQoS(s),
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

    for (const [ct, gnb, s] of this.createNetworkFunctions("5g/gnb1.json", ["air", "n2", "n3"], this.ctx.netdef.gnbs)) {
      s.sysctls["net.ipv4.ip_forward"] = 0;
      compose.annotate(s, "cpus", nWorkers);
      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("gnb");
        Object.assign(config, this.plmn);
        delete config.amf_addr;
        delete config.amf_port;
        config.amf_list = Array.from(this.ctx.gatherIPs("amf", "n2"), (ip) => ({
          ngc_addr: ip,
          ngc_sctp_port: 38412,
        }));
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
        ...applyQoS(s),
      ]);
    }
  }

  private buildUEs(): void {
    const { "phoenix-ue-isolated": isolated } = this.opts;
    const mcc = Number.parseInt(this.plmn.mcc, 10);
    const mnc = Number.parseInt(this.plmn.mnc, 10);
    for (const [ct, sub, s] of this.createNetworkFunctions("5g/ue1.json", ["air"], this.ctx.netdef.listSubscribers())) {
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

        config.Cell = sub.gnbs.map((gnbName): PH.ue_5g_nas_only.Cell => {
          const gnb = findByName(gnbName, this.netdef.gnbs);
          const gnbService = this.ctx.c.services[gnbName]!;
          assert(!!gnb);
          return {
            mcc,
            mnc,
            cell_id: gnb.nci.nci,
            gnb_cp_addr: gnbService.networks.air!.ipv4_address,
            gnb_up_addr: gnbService.networks.air!.ipv4_address,
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
