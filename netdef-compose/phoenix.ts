import path from "node:path";

import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import sql from "sql-tagged-template-literal";

import { NetDef } from "../netdef/netdef.js";
import { phoenixDockerImage, updateService } from "../phoenix-compose/compose.js";
import { applyNetdef, IPMAP, type NetworkFunction, ScenarioFolder } from "../phoenix-config/mod.js";
import type * as N from "../types/netdef.js";
import type * as PH from "../types/phoenix.js";
import type { NetDefComposeContext } from "./context.js";
import { env } from "./env.js";

export async function phoenixCore(ctx: NetDefComposeContext): Promise<void> {
  const b = new PhoenixCoreBuilder(ctx);
  b.build();
  await b.save("core");
}

export async function phoenixRAN(ctx: NetDefComposeContext): Promise<void> {
  const b = new PhoenixRANBuilder(ctx);
  b.build();
  await b.save("ran");
}

class PhoenixScenarioBuilder {
  constructor(protected readonly ctx: NetDefComposeContext) {
    this.ctx.defineNetwork("mgmt", true);

    const [mcc, mnc] = NetDef.splitPLMN(this.network.plmn);
    assert(mnc.length === 2, "Open5GCore only supports 2-digit MNC");
    this.sf.env.set("MCC", mcc);
    this.sf.env.set("MNC", mnc);
    this.sf.env.set("PROMETHEUS_ENABLED", "0");
    this.sf.env.set("COMMAND_DISABLED", "0");
    this.sf.env.set("DISABLE_REMOTE_COMMAND", "0");
  }

  public readonly sf = new ScenarioFolder();
  protected readonly netdef = this.ctx.netdef;
  protected readonly network = this.ctx.network;

  protected tplFile(relPath: string): string {
    return path.resolve(env.D5G_PHOENIX_CFG, relPath);
  }

  protected createNetworkFunction<T>(tpl: string, nets: readonly string[], list?: readonly T[]): Map<string, T> {
    for (const net of nets) {
      this.ctx.defineNetwork(net);
    }
    nets = ["mgmt", ...nets];

    const tplCt = path.basename(tpl, ".json");
    const nf = IPMAP.toNf(tplCt);
    list ??= [{ name: nf } as any];
    const m = IPMAP.suggestNames(nf, list);

    for (const ct of m.keys()) {
      this.ctx.defineService(ct, phoenixDockerImage, nets);
      const ctFile = `${ct}.json`;
      this.sf.createFrom(ctFile, this.tplFile(tpl));
      this.sf.edit(ctFile, (body) => body.replaceAll(`%${tplCt.toUpperCase()}_`, `%${ct.toUpperCase()}_`));
      this.sf.editNetworkFunction(ct, (c) => {
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

  protected createDatabase(tpl: string, db?: string): string {
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

  public async save(kind: "core" | "ran"): Promise<void> {
    this.sf.ipmap = IPMAP.fromCompose(this.ctx.c);
    this.sf.preScaled = true;
    applyNetdef(this.sf, this.ctx.netdef, kind);

    for (const service of Object.values(this.ctx.c.services)) {
      const isRAN = ["gnb", "ue"].includes(IPMAP.toNf(service.container_name));
      if (isRAN !== (kind === "ran")) {
        continue;
      }
      updateService(service);
      for (const volume of service.volumes) {
        switch (volume.source) {
          case "./cfg": {
            volume.source = `./${kind}-cfg`;
            break;
          }
          case "./sql": {
            volume.source = `./${kind}-sql`;
            break;
          }
        }
      }
    }

    await this.sf.save(path.resolve(this.ctx.out, `${kind}-cfg`), path.resolve(this.ctx.out, `${kind}-sql`));
  }
}

class PhoenixCoreBuilder extends PhoenixScenarioBuilder {
  public build(): void {
    this.buildSQL();
    this.buildNRF();
    this.buildUDM();
    this.buildAUSF();
    this.buildAMFs();
    this.buildSMFs();
    this.buildDataPath();
  }

  private buildSQL(): void {
    this.ctx.defineNetwork("db");
    this.ctx.defineService("sql", phoenixDockerImage, ["db"]);
  }

  private buildNRF(): void {
    this.createNetworkFunction("5g/nrf.json", ["cp"]);
  }

  private buildUDM(): void {
    const { netdef, network } = this;
    const dfltSubscribedNSSAI = netdef.nssai.map((snssai): N.SubscriberSNSSAI => ({
      snssai,
      dnns: network.dataNetworks.filter((dn) => dn.snssai === snssai).map((dn) => dn.dnn),
    }));

    const db = this.createDatabase("5g/sql/udm_db.sql");
    this.sf.appendSQL(db, function*() {
      yield "DELETE FROM gpsi_supi_association";
      yield "DELETE FROM supi";
      yield "DELETE FROM gpsi";
      yield "SELECT @am_json:=access_and_mobility_sub_data FROM am_data WHERE supi='0'";
      yield "DELETE FROM am_data";
      yield "SELECT @dnn_json:=json FROM dnn_configurations WHERE supi='default_data' LIMIT 1";
      yield "DELETE FROM dnn_configurations";

      for (const { supi, k, opc, subscribedNSSAI = dfltSubscribedNSSAI } of network.subscribers) {
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

        for (const { snssai, dnns } of subscribedNSSAI) {
          for (const dnn of dnns) {
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
      }
    });

    this.createNetworkFunction("5g/udm.json", ["cp", "db"]);
  }

  private buildAUSF(): void {
    this.createNetworkFunction("5g/ausf.json", ["cp"]);
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
          config.trackingArea.splice(0, Infinity, {
            mcc: "%MCC",
            mnc: "%MNC",
            taiList: [
              { tac: this.netdef.tac },
            ],
          });
        },
      );
    }
  }

  private buildSMFs(): void {
    const { network, netdef } = this;
    let nextTeid = 0x10000000;
    const eachTeid = Math.floor(0xE0000000 / network.smfs.length);
    for (const [ct, smf] of this.createNetworkFunction("5g/smf.json", ["cp", "db", "n4"], network.smfs)) {
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
          config.Associations.Peer.splice(0, Infinity, ...network.upfs.map((upf): PH.pfcp.Acceptor => ({
            type: "udp",
            port: 8805,
            bind: IPMAP.formatEnv(upf.name, "n4"),
          })));
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

  private buildDataPath(): void {
    this.createNetworkFunction("5g/upf2.json", ["n3", "n4", "n6", "n9"], this.ctx.network.upfs);

    this.ctx.defineNetwork("hnet");
    this.ctx.defineService("igw", phoenixDockerImage, ["mgmt", "n6", "hnet"]);
    this.ctx.defineService("hostnat", phoenixDockerImage, ["mgmt", "hnet"]);
    this.sf.initCommands.get("igw").push(
      "ip link set n6 mtu 1456",
      "iptables -w -t nat -A POSTROUTING -o hnet -j MASQUERADE",
    );
  }
}

class PhoenixRANBuilder extends PhoenixScenarioBuilder {
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
    const allGNBs = this.network.gnbs.map((gnb) => gnb.name);
    this.sf.createFrom("ue-tunnel-mgmt.sh", this.tplFile("5g/ue-tunnel-mgmt.sh"));
    for (const [ct, subscriber] of this.createNetworkFunction("5g/ue1.json", ["air"], this.ctx.network.subscribers)) {
      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("ue_5g_nas_only");
        config.usim = {
          supi: subscriber.supi,
          k: subscriber.k,
          amf: USIM.amf,
          opc: subscriber.opc,
          start_sqn: USIM.sqn,
        };
        delete config["usim-test-vector19"];

        const nssai = subscriber.requestedNSSAI ?? subscriber.subscribedNSSAI ?? [];
        config.dn_list.splice(0, Infinity, ...nssai.flatMap(({ snssai, dnns }): PH.ue_5g_nas_only.DN[] => dnns.map(
          (dnn): PH.ue_5g_nas_only.DN => {
            const dn = this.netdef.findDN(dnn, snssai);
            assert(dn && dn.type !== "IPv6");
            return {
              dnn: dn.dnn,
              dn_type: dn.type,
            };
          },
        )));
        config.DefaultNetwork.dnn = config.dn_list[0]?.dnn ?? "default";

        config.Cell.splice(0, Infinity, ...(subscriber.gnbs ?? allGNBs).map((name): PH.ue_5g_nas_only.Cell => {
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
        }));
      });
      this.sf.initCommands.set(ct, [
        "ip link set air mtu 1470",
      ]);
    }
  }
}

function expandSNSSAI(snssai: N.SNSSAI): PH.SNSSAI {
  const [sstHex, sd] = NetDef.splitSNSSAI(snssai);
  const sst = Number.parseInt(sstHex, 16);
  return sd === undefined ? { sst } : { sst, sd };
}

function setNrfClientSlices(c: NetworkFunction, nssai: readonly N.SNSSAI[]): void {
  const { config } = c.getModule("nrf_client");
  config.nf_profile.sNssais.splice(0, Infinity, ...nssai.map((snssai) => expandSNSSAI(snssai)));
}

const USIM = { sqn: "000000000001", amf: "8000" } as const;
