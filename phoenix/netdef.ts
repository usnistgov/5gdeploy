import path from "node:path";

import * as fsWalk from "@nodelib/fs.walk/promises";
import { Netmask } from "netmask";
import sql from "sql-tagged-template-literal";

import * as compose from "../compose/mod.js";
import { importGrafanaDashboard, makeUPFRoutes, NetDef, type NetDefComposeContext, setProcessExporterRule } from "../netdef-compose/mod.js";
import type { ComposeService, N, PH } from "../types/mod.js";
import { assert, file_io, findByName, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { NetworkFunction } from "./nf.js";

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
    defaultDescription: "true if phoenix-upf-workers is greater than 1",
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
  "phoenix-upf-taskset": tasksetOption("UPF"),
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
  "phoenix-gnb-taskset": tasksetOption("gNB"),
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

function tasksetOption(nf: string) {
  return {
    coerce(input: string): ["none" | "shhi" | "shlo", number] {
      const [mode = "", count = "1"] = input.split(":");
      assert(["none", "shhi", "shlo"].includes(mode), "bad --phoenix-*-taskset");
      if (mode === "none") {
        return [mode, 0];
      }
      const cnt = Number.parseInt(count, 10);
      assert([1, 2, 3, 4].includes(cnt), "bad --phoenix-*-taskset");
      return [mode, cnt] as any;
    },
    default: "shhi",
    desc: `configure CPU affinity for ${nf} worker threads`,
    group: "phoenix",
    type: "string",
  } as const;
}

function* tasksetScript(opt: PhoenixOpts["phoenix-upf-taskset"], nWorkers: number, workerPrefix: string): Iterable<string> {
  const [mode, cnt] = opt;
  if (mode === "none") {
    return;
  }
  yield `/taskset.sh ${mode} ${cnt} ${workerPrefix} ${nWorkers} &`;
}

interface PhoenixServiceContext {
  s: ComposeService;
  nf: NetworkFunction;
  initCommands: string[];
  makeDatabase: (tpl: `${string}.sql`, database: PH.Database, append: Iterable<string>) => Promise<void>;
}

abstract class PhoenixScenarioBuilder {
  protected abstract nfKind: string;
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

  protected get netdef() { return this.ctx.netdef; }
  protected get network() { return this.ctx.network; }
  private readonly unsaved = new Map<string, PhoenixServiceContext>();

  private tplFile(relPath: string): string {
    return path.resolve(this.opts["phoenix-cfg"], relPath);
  }

  protected async defineService(ct: string, nets: readonly string[], tpl: `${string}.json`): Promise<PhoenixServiceContext> {
    const s = this.ctx.defineService(ct, phoenixDockerImage, ["mgmt", ...nets]);
    s.working_dir = cfgdir;
    s.stdin_open = true;
    s.tty = true;
    s.cap_add.push("NET_ADMIN");
    s.sysctls["net.ipv4.ip_forward"] = 1;
    s.sysctls["net.ipv6.conf.all.disable_ipv6"] = 1;

    const initCommands: string[] = [];
    const sc: PhoenixServiceContext = {
      s,
      nf: await this.loadNF(tpl, s),
      initCommands,
      makeDatabase: async (tpl, d, append) => {
        d.database = ct;
        d.hostname = compose.getIP(this.ctx.c, "sql", "db");
        await this.ctx.writeFile(
          `${this.nfKind}-sql/${ct}.sql`,
          compose.mysql.join(await this.loadDatabase(tpl, ct), append),
        );
        initCommands.push(...compose.mysql.wait(d.hostname, d.username, d.password, ct));
      },
    };
    this.unsaved.set(ct, sc);
    return sc;
  }

  private async loadNF(tpl: string, s: ComposeService): Promise<NetworkFunction> {
    const tplCt = path.basename(tpl, ".json");
    let body = await file_io.readText(this.tplFile(tpl), { once: true });
    body = body.replaceAll(/"%([A-Z\d]+)_([A-Z\d]+)_IP"/g, (m, ct: string, net: string) => {
      void m;
      ct = ct.toLowerCase();
      net = net.toLowerCase();
      let ip = "unresolved-ip-address";
      try {
        ip = ct === tplCt ? compose.getIP(s, net) : compose.getIP(this.ctx.c, ct, net);
      } catch {}
      return JSON.stringify(ip);
    });

    const nf = NetworkFunction.parse(body);

    for (const binaryName of ["httpd", "json_rpc", "remote_command", "rest_api"] as const) {
      nf.editModule(binaryName, true, (m) => {
        delete m.ignore;
      });
    }

    nf.editModule("command", true, ({ config }) => {
      config.DisablePrompt = false;
      config.GreetingText = `${s.container_name.toUpperCase()}>`;
    });

    nf.editModule("nrf_client", true, ({ config }) => {
      config.nf_profile.plmnList = [this.plmn];
      config.nf_profile.nfInstanceId = globalThis.crypto.randomUUID();
    });

    nf.editModule("monitoring", true, ({ config }) => {
      this.hasPrometheus = true;
      const mgmt = compose.getIP(s, "mgmt");
      config.Prometheus = {
        listener: mgmt,
        port: 9888,
        enabled: 1,
      };

      const target = new URL("http://localhost:9888/metrics");
      target.hostname = mgmt;
      target.searchParams.set("job_name", "phoenix");
      target.searchParams.append("labels", `phnf=${s.container_name}`);
      compose.annotate(s, "prometheus_target", target.toString());
    });

    return nf;
  }

  private async loadDatabase(tpl: string, dbName: string): Promise<string> {
    let body = await file_io.readText(this.tplFile(tpl), { once: true });
    body = body.replace(/^create database .*;$/im, `CREATE OR REPLACE DATABASE ${dbName};`);
    body = body.replaceAll(/^create database .*;$/gim, "");
    body = body.replaceAll(/^use .*;$/gim, `USE ${dbName};`);
    body = body.replaceAll(/^grant ([a-z,]*) on \w+\.\* to (.*);$/gim, `GRANT $1 ON ${dbName}.* TO $2;`);
    return body;
  }

  public async finish(): Promise<void> {
    for (const [ct, { s, nf, initCommands }] of this.unsaved) {
      await this.ctx.writeFile(`${this.nfKind}-cfg/${ct}.json`, nf, {
        s, target: path.join(cfgdir, `${ct}.json`),
      });
      compose.setCommands(s, [
        ...compose.renameNetifs(s, { disableTxOffload: true }),
        ...initCommands ?? [],
        `exec /opt/phoenix/dist/phoenix.sh -j ${ct}.json -p /opt/phoenix/dist/lib`,
      ]);
    }
    this.unsaved.clear();

    if (this.hasPrometheus) {
      await this.updatePrometheus();
    }
  }

  private async updatePrometheus(): Promise<void> {
    setProcessExporterRule(this.ctx, "phoenix",
      [{
        comm: ["phoenix"],
        cmdline: [/-j (?:[\w/]+\/)?(?<NF>\w+)\.json/],
        name: "phoenix:{{.Matches.NF}}",
      }],
      [{
        source_labels: ["groupname"],
        regex: /phoenix:(\w+)/,
        target_label: "phnf",
      }],
    );

    for (const entry of await fsWalk.walk(this.tplFile("5g/prometheus"), {
      entryFilter: (entry) => entry.name.endsWith(".json"),
    })) {
      await importGrafanaDashboard(this.ctx, entry.path);
    }
  }
}

class PhoenixCPBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "cp";

  public async build(): Promise<void> {
    compose.mysql.define(this.ctx, "./cp-sql");
    await this.defineService("nrf", ["cp"], "5g/nrf.json");
    await this.buildUDM();
    await this.defineService("ausf", ["cp"], "5g/ausf.json");
    await this.buildNSSF();

    for (const amf of this.ctx.netdef.amfs) {
      await this.buildAMF(amf);
    }

    const { smfs } = this.ctx.netdef;
    assert(smfs.length <= 250);
    for (const [i, smf] of smfs.entries()) {
      await this.buildSMF(smf, (1 + i) << 24);
    }
    await this.finish();
  }

  private async buildUDM(): Promise<void> {
    const { nf, makeDatabase } = await this.defineService("udm", ["db", "cp"], "5g/udm.json");
    await nf.editModule("udm", async ({ config }) => {
      await makeDatabase("5g/sql/udm_db.sql", config.Database, this.makeUDMDatabase());
    });
  }

  private *makeUDMDatabase(): Iterable<string> {
    yield "DELETE FROM gpsi_supi_association";
    yield "DELETE FROM supi";
    yield "DELETE FROM gpsi";
    yield "SELECT @am_json:=access_and_mobility_sub_data FROM am_data WHERE supi='0'";
    yield "DELETE FROM am_data";
    yield "SELECT @dnn_json:=json FROM dnn_configurations WHERE supi='default_data' LIMIT 1";
    yield "DELETE FROM dnn_configurations";

    for (const { supi, k, opc, subscribedNSSAI, subscribedDN } of this.netdef.listSubscribers()) {
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
        const dn = this.netdef.findDN(dnn, snssai);
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
  }

  private async buildNSSF(): Promise<void> {
    const amfNSSAIs = new Set<string>();
    for (const amf of this.netdef.amfs) {
      amf.nssai.sort((a, b) => a.localeCompare(b));
      amfNSSAIs.add(amf.nssai.join(","));
    }
    if (amfNSSAIs.size <= 1) {
      return;
    }

    const { nf, makeDatabase } = await this.defineService("nssf", ["db", "cp"], "5g_nssf/nssf.json");
    await nf.editModule("nssf", async ({ config }) => {
      await makeDatabase("5g_nssf/sql/nssf_db.sql", config.database, this.makeNSSFDatabase());
    });
  }

  private *makeNSSFDatabase(): Iterable<string> {
    yield "DELETE FROM snssai_nsi_mapping";
    yield "DELETE FROM nsi";
    yield "DELETE FROM snssai";
    for (const [i, amf] of this.netdef.amfs.entries()) {
      yield sql`INSERT nsi (nsi_id,nrf_id,target_amf_set) VALUES (${`nsi_id_${i}`},${`nrf_id_${i}`},${`${amf.amfi[1]}`}) RETURNING @nsi_id:=row_id`;
      for (const snssai of amf.nssai) {
        const { sst, sd = "" } = NetDef.splitSNSSAI(snssai).ih;
        yield sql`INSERT snssai (sst,sd) VALUES (${sst},${sd}) RETURNING @snssai_id:=row_id`;
        yield "INSERT snssai_nsi_mapping (row_id_snssai,row_id_nsi) VALUES (@snssai_id,@nsi_id)";
      }
    }
  }

  private async buildAMF(amf: NetDef.AMF): Promise<void> {
    const { nf } = await this.defineService(amf.name, ["cp", "n2"], "5g/amf.json");
    setNrfClientSlices(nf, amf.nssai);
    nf.editModule("amf", ({ config }) => {
      config.id = amf.name;
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
      config.hacks.enable_reroute_nas = !!this.ctx.c.services.nssf;
    });
  }

  private async buildSMF(smf: NetDef.SMF, startTeid: number): Promise<void> {
    const { nf, initCommands, makeDatabase } = await this.defineService(smf.name, ["db", "cp", "n4"], "5g/smf.json");
    setNrfClientSlices(nf, smf.nssai);

    await nf.editModule("smf", async ({ config }) => {
      Object.assign(config, this.plmn);
      await makeDatabase("5g/sql/smf_db.sql", config.Database, this.makeSMFDatabase());
      config.id = smf.name;
      config.mtu = 1456;
      config.startTeid = startTeid;
    });

    nf.editModule("sdn_routing_topology", ({ config }) => {
      config.Topology.Link = this.netdef.dataPathLinks.flatMap(({ a: nodeA, b: nodeB, cost }) => {
        const typeA = this.determineDataPathNodeType(nodeA);
        const typeB = this.determineDataPathNodeType(nodeB);
        const dn = typeA === "DNN" ? nodeA as N.DataNetworkID : typeB === "DNN" ? nodeB as N.DataNetworkID : undefined;
        if (dn && ((
          smf.nssai && !smf.nssai.includes(dn.snssai) // DN not in SMF's NSSAI
        ) || (
          this.netdef.findDN(dn)!.type !== "IPv4" // Ethernet DN cannot appear in sdn_routing_topology because it has no N6
        ))) {
          return [];
        }
        return {
          weight: cost,
          Node_A: this.makeDataPathTopoNode(nodeA, typeA, typeB),
          Node_B: this.makeDataPathTopoNode(nodeB, typeB, typeA),
        };
      });
    });

    nf.editModule("pfcp", ({ config }) => {
      config.Associations.Peer = Array.from(compose.listByNf(this.ctx.c, "upf"), (upf) => ({
        type: "udp",
        port: 8805,
        bind: compose.getIP(upf, "n4"),
      } as const));
      config.Associations.heartbeat_interval = 5;
      config.Associations.max_heartbeat_retries = 2;

      // After an initial PFCP Association Setup Request times out, the SMF may generate duplicate
      // PFCP Association Setup Requests and end up with multiple associations with the same UPF.
      // This eventually leads to heartbeat timeout and SMF crash. To avoid this situation, we
      // wait for all UPFs to come online before launching the SMF.
      initCommands.push(...compose.waitReachable("UPF", Array.from(config.Associations.Peer, ({ bind }) => bind)));
    });
  }

  private *makeSMFDatabase(): Iterable<string> {
    yield "DELETE FROM dn_dns";
    yield "DELETE FROM dn_info";
    yield "DELETE FROM dn_ipv4_allocations";
    yield "DELETE FROM dnn";
    for (const { dnn, type, subnet } of this.network.dataNetworks) {
      yield sql`INSERT dnn (dnn) VALUES (${dnn}) RETURNING @dn_id:=dn_id`;
      if (type === "IPv4") {
        assert(!!subnet);
        const net = new Netmask(subnet);
        yield "INSERT dn_dns (dn_id,addr,ai_family) VALUES (@dn_id,'1.1.1.1',2)";
        yield sql`INSERT dn_info (dnn,network,prefix) VALUES (${dnn},${net.base},${net.bitmask})`;
      }
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
          id: compose.getIP(upf, "n4"),
          ip: compose.getIP(upf, {
            DNN: "n6",
            gNodeB: "n3",
            UPF: "n9",
          }[peerType]),
        };
      }
    }
  }
}
/** Build CP functions using Open5GCore. */
export async function phoenixCP(ctx: NetDefComposeContext, opts: PhoenixOpts): Promise<void> {
  const b = new PhoenixCPBuilder(ctx, opts);
  await b.build();
}

class PhoenixUPBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "up";

  public async buildUPF(upf: N.UPF): Promise<void> {
    const ct = upf.name;
    const nWorkers = this.opts["phoenix-upf-workers"];
    assert(nWorkers <= 8, "pfcp.so allows up to 8 threads");

    const peers = this.netdef.gatherUPFPeers(upf);
    assert(peers.N6Ethernet.length <= 1, "UPF only supports one Ethernet DN");
    assert(peers.N6IPv6.length === 0, "UPF does not support IPv6 DN");

    const { s, nf, initCommands } = await this.defineService(ct, ([
      ["n4", 1],
      ["n3", peers.N3.length],
      ["n9", peers.N9.length],
      ["n6", peers.N6IPv4.length],
    ] satisfies Array<[string, number]>).filter(([, cnt]) => cnt > 0).map(([net]) => net), "5g/upf1.json");
    compose.annotate(s, "cpus", this.opts["phoenix-upf-taskset"][1] + nWorkers);
    for (const netif of ["all", "default"]) {
      s.sysctls[`net.ipv4.conf.${netif}.accept_local`] = 1;
      s.sysctls[`net.ipv4.conf.${netif}.rp_filter`] = 2;
    }
    s.devices.push("/dev/net/tun:/dev/net/tun");

    nf.editModule("pfcp", ({ config }) => {
      assert(config.mode === "UP");
      assert(config.data_plane_mode === "integrated");
      assert(config.DataPlane.xdp);

      let nThreadPoolWorkers = nWorkers;
      let needThreadPool = false;
      const getInterfaceMode = (intf: "n3" | "n9" | "n6"): PH.pfcp.Interface["mode"] => {
        if (this.opts[`phoenix-upf-single-worker-${intf}`] ?? (intf === "n3" && nWorkers > 1)) {
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
          bind_ip: compose.getIP(s, "n3"),
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
          bind_ip: compose.getIP(s, "n9"),
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
          bind_ip: compose.getIP(s, "n6"),
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
        s.environment.XDP_GTP = "/opt/phoenix/dist/lib/objects-Debug/xdp_program_files/xdp_gtp.c.o";
        s.cap_add.push("BPF", "SYS_ADMIN");
      } else {
        delete config.DataPlane.xdp;
      }
      assert(needThreadPool ? nThreadPoolWorkers > 0 : nThreadPoolWorkers >= 0,
        "insufficient thread_pool workers after satisfying single_thread interfaces");

      config.hacks.qfi = 1; // only effective in non-XDP mode
    });

    initCommands.push(
      ...compose.applyQoS(s),
      ...(peers.N6IPv4.length > 0 ? [
        "ip tuntap add mode tun user root name n6_tun",
        "ip link set n6_tun up",
      ] : []),
      ...Array.from(peers.N6IPv4, ({ subnet }) => `ip route add ${subnet} dev n6_tun`),
      ...(peers.N6Ethernet.length > 0 ? [
        "ip link add name br-eth type bridge",
        "ip link set br-eth up",
        "ip tuntap add mode tap user root name n6_tap",
        "ip link set n6_tap up master br-eth",
      ] : []),
      ...makeUPFRoutes(this.ctx, peers),
      ...tasksetScript(this.opts["phoenix-upf-taskset"], nWorkers, "UPFSockFwd_"),
    );
  }
}
/** Build UP functions using Open5GCore as UPF. */
export async function phoenixUP(ctx: NetDefComposeContext, upf: N.UPF, opts: PhoenixOpts): Promise<void> {
  const b = new PhoenixUPBuilder(ctx, opts);
  await b.buildUPF(upf);
  await b.finish();
}

class PhoenixRANBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "ran";

  public async build(): Promise<void> {
    await this.buildGNBs();
    await this.buildUEs();
    await this.finish();
  }

  private async buildGNBs(): Promise<void> {
    const sliceKeys = ["slice", "slice2"] as const;
    const slices = this.netdef.nssai.map((snssai) => NetDef.splitSNSSAI(snssai).ih);
    assert(slices.length <= sliceKeys.length, `gNB allows up to ${sliceKeys.length} slices`);
    const nWorkers = this.opts["phoenix-gnb-workers"];

    for (const gnb of this.ctx.netdef.gnbs) {
      const { s, nf, initCommands } = await this.defineService(gnb.name, ["air", "n2", "n3"], "5g/gnb1.json");
      s.sysctls["net.ipv4.ip_forward"] = 0;
      compose.annotate(s, "cpus", this.opts["phoenix-gnb-taskset"][1] + nWorkers);

      nf.editModule("gnb", ({ config }) => {
        Object.assign(config, this.plmn);
        delete config.amf_addr;
        delete config.amf_port;
        config.amf_list = Array.from(compose.listByNf(this.ctx.c, "amf"), (amf) => ({
          ngc_addr: compose.getIP(amf, "n2"),
          ngc_sctp_port: 38412,
        } as const));
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

      initCommands.push(
        "iptables -I OUTPUT -p icmp --icmp-type destination-unreachable -j DROP",
        ...compose.applyQoS(s),
        ...tasksetScript(this.opts["phoenix-gnb-taskset"], nWorkers, "gnbUSockFwd"),
      );
    }
  }

  private async buildUEs(): Promise<void> {
    const { "phoenix-ue-isolated": isolated } = this.opts;
    const mcc = Number.parseInt(this.plmn.mcc, 10);
    const mnc = Number.parseInt(this.plmn.mnc, 10);

    for (const [ct, sub] of compose.suggestUENames(this.ctx.netdef.listSubscribers())) {
      const { s, nf } = await this.defineService(ct, ["air"], "5g/ue1.json");
      compose.annotate(s, "cpus", isolated.some((suffix) => sub.supi.endsWith(suffix)) ? 1 : 0);
      compose.annotate(s, "ue_supi", sub.supi);

      nf.editModule("ue_5g_nas_only", ({ config }) => {
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
            gnb_cp_addr: compose.getIP(gnbService, "air"),
            gnb_up_addr: compose.getIP(gnbService, "air"),
            gnb_port: 10000,
          };
        });

        config.ip_tool = "/opt/phoenix/cfg/5g/ue-tunnel-mgmt.sh";
      });
    }
  }
}
/** Build RAN functions using Open5GCore RAN simulators. */
export async function phoenixRAN(ctx: NetDefComposeContext, opts: PhoenixOpts): Promise<void> {
  const b = new PhoenixRANBuilder(ctx, opts);
  await b.build();
}

function setNrfClientSlices(c: NetworkFunction, nssai: readonly N.SNSSAI[]): void {
  c.editModule("nrf_client", ({ config }) => {
    config.nf_profile.sNssais = nssai.map((snssai) => NetDef.splitSNSSAI(snssai).ih);
  });
}

const USIM = { sqn: "000000000001", amf: "8000" } as const;
