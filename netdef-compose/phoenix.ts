import path from "node:path";

import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import sql from "sql-tagged-template-literal";
import type { Constructor } from "type-fest";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import { networkOptions, phoenixDockerImage, updateService } from "../phoenix-compose/compose.js";
import { IPMAP, type NetworkFunction, ScenarioFolder } from "../phoenix-config/mod.js";
import type * as N from "../types/netdef.js";
import type * as PH from "../types/phoenix.js";
import type { NetDefComposeContext } from "./context.js";
import * as NetDefDN from "./dn.js";
import { env } from "./env.js";

export function makeBuilder(cls: Constructor<PhoenixScenarioBuilder, [NetDefComposeContext]>): (ctx: NetDefComposeContext, saveHooks?: SaveHooks) => Promise<void> {
  return async (ctx: NetDefComposeContext, saveHooks: SaveHooks = {}): Promise<void> => {
    const b = new cls(ctx);
    b.build();
    await b.save(saveHooks);
  };
}

abstract class PhoenixScenarioBuilder {
  protected abstract nfKind: string;
  protected abstract nfFilter: readonly string[];

  constructor(protected readonly ctx: NetDefComposeContext) {
    for (const [net, opts] of Object.entries(networkOptions)) {
      this.ctx.defineNetwork(net, opts);
    }

    const [mcc, mnc] = NetDef.splitPLMN(this.network.plmn);
    assert(mnc.length === 2, "Open5GCore only supports 2-digit MNC");
    this.sf.env.set("MCC", mcc);
    this.sf.env.set("MNC", mnc);
    this.sf.env.set("PROMETHEUS_ENABLED", "0");
    this.sf.env.set("COMMAND_DISABLED", "0");
    this.sf.env.set("DISABLE_REMOTE_COMMAND", "0");
  }

  public readonly sf = new ScenarioFolder();
  protected get netdef() { return this.ctx.netdef; }
  protected get network() { return this.ctx.network; }

  public abstract build(): void;

  protected tplFile(relPath: string): string {
    return path.resolve(env.D5G_PHOENIX_CFG, relPath);
  }

  protected createNetworkFunction<T>(tpl: `${string}.json`, nets: readonly string[], list?: readonly T[]): Map<string, T> {
    nets = ["mgmt", ...nets];

    const tplCt = path.basename(tpl, ".json");
    const nf = compose.nameToNf(tplCt);
    const tplFile = this.tplFile(tpl);
    list ??= [{ name: nf } as any];
    const m = compose.suggestNames(nf, list);

    for (const ct of m.keys()) {
      this.ctx.defineService(ct, phoenixDockerImage, nets);
      const ctFile = `${ct}.json`;
      this.sf.createFrom(ctFile, tplFile);
      this.sf.edit(ctFile, (body) => body.replaceAll(`%${tplCt.toUpperCase()}_`, `%${ct.toUpperCase()}_`));
      this.sf.editNetworkFunction(ct, (c) => {
        c.Phoenix.Module.sort((a, b) => a.binaryFile.localeCompare(b.binaryFile));

        const command = c.getModule("command", true);
        if (command) {
          command.config.GreetingText = `${ct.toUpperCase()}>`;
        }

        const nrfClient = c.getModule("nrf_client", true);
        if (nrfClient) {
          nrfClient.config.nf_profile.nfInstanceId = globalThis.crypto.randomUUID();
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

  public async save({
    nfFilter = (nf: string) => this.nfFilter.includes(nf),
  }: SaveHooks): Promise<void> {
    this.sf.ipmap = IPMAP.fromCompose(this.ctx.c);
    for (const service of Object.values(this.ctx.c.services)) {
      if (!nfFilter(compose.nameToNf(service.container_name))) {
        continue;
      }
      updateService(service, { cfg: `./${this.nfKind}-cfg`, sql: `./${this.nfKind}-sql` });
    }

    await this.sf.save(path.resolve(this.ctx.out, `${this.nfKind}-cfg`), path.resolve(this.ctx.out, `${this.nfKind}-sql`));
  }
}

interface SaveHooks {
  nfFilter?: (nf: string) => boolean;
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
            defaultSingleNssais: subscribedNSSAI.map(({ snssai }) => expandSNSSAI(snssai)),
          },
        };
        yield sql`INSERT am_data (supi,access_and_mobility_sub_data) VALUES (${supi},JSON_MERGE_PATCH(@am_json,${amPatch}))`;

        for (const { snssai, dnn } of subscribedDN) {
          const dn = netdef.findDN(dnn, snssai);
          assert(!!dn);
          const { sst } = expandSNSSAI(snssai);
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
    const { network, netdef: { nssai: defaultNSSAI } } = this;
    const amfNSSAIs = new Set<string>();
    for (const amf of network.amfs) {
      const { nssai = defaultNSSAI } = amf;
      nssai.sort((a, b) => a.localeCompare(b));
      amfNSSAIs.add(nssai.join(","));
    }
    if (amfNSSAIs.size <= 1) {
      return;
    }

    const db = this.createDatabase("5g_nssf/sql/nssf_db.sql");
    this.sf.appendSQL(db, function*() {
      yield "DELETE FROM snssai_nsi_mapping";
      yield "DELETE FROM nsi";
      yield "DELETE FROM snssai";
      for (const [i, amf] of network.amfs.entries()) {
        const [, set] = NetDef.validateAMFI(amf.amfi);
        yield sql`INSERT nsi (nsi_id,nrf_id,target_amf_set) VALUES (${`nsi_id_${i}`},${`nrf_id_${i}`},${`${set}`}) RETURNING @nsi_id:=row_id`;
        for (const snssai of amf.nssai ?? defaultNSSAI) {
          const { sst, sd = "" } = expandSNSSAI(snssai);
          yield sql`INSERT snssai (sst,sd) VALUES (${sst},${sd}) RETURNING @snssai_id:=row_id`;
          yield "INSERT snssai_nsi_mapping (row_id_snssai,row_id_nsi) VALUES (@snssai_id,@nsi_id)";
        }
      }
    });

    this.createNetworkFunction("5g_nssf/nssf.json", ["db", "cp"]);
  }

  private buildAMFs(): void {
    for (const [ct, amf] of this.createNetworkFunction("5g/amf.json", ["cp", "n2"], this.ctx.network.amfs)) {
      this.sf.editNetworkFunction(ct,
        (c) => setNrfClientSlices(c, amf.nssai ?? this.netdef.nssai),
        (c) => {
          const { config } = c.getModule("amf");
          config.id = ct;
          const [regionId, amfSetId, amfPointer] = NetDef.validateAMFI(amf.amfi);
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
    const { network, netdef } = this;
    let nextTeid = 0x10000000;
    const eachTeid = Math.floor(0xE0000000 / network.smfs.length);
    for (const [ct, smf] of this.createNetworkFunction("5g/smf.json", ["db", "cp", "n4"], network.smfs)) {
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
        (c) => setNrfClientSlices(c, smf.nssai ?? netdef.nssai),
        (c) => {
          const { config } = c.getModule("smf");
          config.Database.database = db;
          config.id = ct;
          config.mtu = 1456;
          config.startTeid = startTeid;
        },
        (c) => {
          const { config } = c.getModule("sdn_routing_topology");
          config.Topology.Link = netdef.dataPathLinks.flatMap(({ a: nodeA, b: nodeB, cost }) => {
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
    if (this.netdef.findGNB(node) !== undefined) {
      return "gNodeB";
    }
    if (this.netdef.findUPF(node) !== undefined) {
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
        const gnb = this.netdef.findGNB(node as string)!;
        return {
          type: "gNodeB",
          id: this.netdef.splitNCI(gnb.nci).gnb,
          ip: "255.255.255.255",
        };
      }
    }

    const upf = this.netdef.findUPF(node as string)!;
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
    for (const [ct, upf] of this.createNetworkFunction("5g/upf2.json", ["n3", "n4", "n6", "n9"], this.ctx.network.upfs)) {
      const peers = this.netdef.gatherUPFPeers(upf);
      assert(peers.N6Ethernet.length <= 1, "UPF only supports one Ethernet DN");
      assert(peers.N6IPv6.length === 0, "UPF does not supports IPv6 DN");

      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("pfcp");
        assert(config.mode === "UP");
        assert(config.data_plane_mode === "integrated");
        config.ethernet_session_identifier = peers.N6Ethernet[0]?.dnn;
        config.DataPlane.interfaces = [];
        if (peers.N3.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n3_n9",
            name: "n3",
            bind_ip: IPMAP.formatEnv(ct, "n3"),
            mode: "single_thread",
          });
        }
        if (peers.N9.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n3_n9",
            name: "n9",
            bind_ip: IPMAP.formatEnv(ct, "n9"),
            mode: "thread_pool",
          });
        }
        if (peers.N6IPv4.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n6_l3",
            name: "n6_tun",
            bind_ip: IPMAP.formatEnv(ct, "n6"),
            mode: "thread_pool",
          });
        }
        if (peers.N6Ethernet.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n6_l2",
            name: "n6_tap",
            mode: "thread_pool",
          });
        }
        assert(config.DataPlane.interfaces.length <= 8, "pfcp.so allows up to 8 interfaces");
        delete config.DataPlane.xdp;
      });

      this.sf.initCommands.set(ct, [
        ...(function*() {
          if (peers.N6IPv4.length > 0) {
            yield "ip tuntap add mode tun user root name n6_tun";
            yield "ip link set n6_tun up";
          }
          if (peers.N6Ethernet.length > 0) {
            yield "ip link add name br-eth type bridge";
            yield "ip link set br-eth up";
            yield "ip tuntap add mode tap user root name n6_tap";
            yield "ip link set n6_tap up master br-eth";
          }
        })(),
        ...Array.from(NetDefDN.makeUPFRoutes(this.ctx, peers), (line) => line.replace(/^msg /, ": ")),
      ]);

      for (const { subnet } of peers.N6IPv4) {
        this.sf.routes.set(ct, { dest: new Netmask(subnet!), dev: "n6_tun" });
      }
    }
  }
}
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
    const slices = this.netdef.nssai.map((snssai) => expandSNSSAI(snssai));
    assert(slices.length <= sliceKeys.length, `gNB allows up to ${sliceKeys.length} slices`);

    for (const [ct, gnb] of this.createNetworkFunction("5g/gnb1.json", ["air", "n2", "n3"], this.ctx.network.gnbs)) {
      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("gnb");
        delete config.amf_addr;
        delete config.amf_port;
        config.amf_list = this.network.amfs.map((amf): PH.gnb.AMF => ({
          ngc_addr: IPMAP.formatEnv(amf.name, "n2"),
          ngc_sctp_port: 38412,
        }));
        config.mcc = "%MCC";
        config.mnc = "%MNC";
        ({ gnb: config.gnb_id, nci: config.cell_id } = this.netdef.splitNCI(gnb.nci));
        config.tac = this.netdef.tac;

        for (const [i, k] of sliceKeys.entries()) {
          if (slices.length > i) {
            config[k] = slices[i];
          } else {
            delete config[k]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
          }
        }
      });
      this.sf.initCommands.set(ct, [
        "iptables -I OUTPUT -p icmp --icmp-type destination-unreachable -j DROP",
      ]);
    }
  }

  private buildUEs(): void {
    this.sf.createFrom("ue-tunnel-mgmt.sh", this.tplFile("5g/ue-tunnel-mgmt.sh"));
    for (const [ct, sub] of this.createNetworkFunction("5g/ue1.json", ["air"], this.ctx.netdef.listSubscribers())) {
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
          const gnb = this.netdef.findGNB(name);
          assert(!!gnb);
          return {
            cell_id: this.netdef.splitNCI(gnb.nci).nci,
            mcc: "%MCC",
            mnc: "%MNC",
            gnb_cp_addr: ip,
            gnb_up_addr: ip,
            gnb_port: 10000,
          };
        });
      });
    }
  }
}
export const phoenixRAN = makeBuilder(PhoenixRANBuilder);

function expandSNSSAI(snssai: N.SNSSAI): PH.SNSSAI {
  const { int: { sst }, hex: { sd } } = NetDef.splitSNSSAI(snssai);
  return { sst, sd };
}

function setNrfClientSlices(c: NetworkFunction, nssai: readonly N.SNSSAI[]): void {
  const { config } = c.getModule("nrf_client");
  config.nf_profile.sNssais = nssai.map((snssai) => expandSNSSAI(snssai));
}

const USIM = { sqn: "000000000001", amf: "8000" } as const;
