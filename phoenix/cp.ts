import { Netmask } from "netmask";
import { sortBy } from "sort-by-typescript";
import sql from "sql-tagged-template-literal";

import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { N, PH } from "../types/mod.js";
import { assert, findByName } from "../util/mod.js";
import { PhoenixScenarioBuilder } from "./builder.js";
import type { NetworkFunction } from "./nf.js";
import { type PhoenixOpts, USIM } from "./options.js";

/** Build CP functions using Open5GCore. */
export async function phoenixCP(ctx: NetDefComposeContext, opts: PhoenixOpts): Promise<void> {
  const b = new PhoenixCPBuilder(ctx, opts);
  await b.build();
}

class PhoenixCPBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "cp";

  public async build(): Promise<void> {
    compose.mysql.define(this.ctx, "./cp-sql");
    await this.defineService("nrf", ["cp"], "5g/nrf.json");
    await this.buildUDM();
    await this.defineService("ausf", ["cp"], "5g/ausf.json");
    await this.buildNSSF();

    for (const amf of netdef.listAmfs(this.ctx.network)) {
      await this.buildAMF(amf);
    }

    const smfs = netdef.listSmfs(this.ctx.network);
    assert(smfs.length <= 250);
    for (const [i, smf] of smfs.entries()) {
      await this.buildSMF(smf, (1 + i) << 24);
    }

    if (this.opts["phoenix-pcf"]) {
      await this.buildPCF();
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

    for (const { supi, k, opc, subscribedNSSAI, subscribedDN, ambr } of netdef.listSubscribers(this.ctx.network)) {
      yield sql`
        INSERT supi (identity,k,amf,op,sqn,auth_type,op_is_opc,usim_type)
        VALUES (${supi},UNHEX(${k}),UNHEX(${USIM.amf}),UNHEX(${opc}),UNHEX(${USIM.sqn}),0,1,0)
        RETURNING @supi_id:=id
      `;
      yield sql`INSERT gpsi (identity) VALUES (${`msisdn-${supi}`}) RETURNING @gpsi_id:=id`;
      yield "INSERT gpsi_supi_association (gpsi_id,supi_id) VALUES (@gpsi_id,@supi_id)";

      const amPatch = {
        subscribedUeAmbr: ambr,
        nssai: {
          defaultSingleNssais: subscribedNSSAI.map(({ snssai }) => netdef.splitSNSSAI(snssai).ih),
        },
      };
      yield sql`INSERT am_data (supi,access_and_mobility_sub_data) VALUES (${supi},JSON_MERGE_PATCH(@am_json,${amPatch}))`;

      for (const dnID of subscribedDN) {
        const { dnn, snssai, sessionType, fiveQi, ambr } = netdef.findDN(this.ctx.network, dnID);
        const { sst } = netdef.splitSNSSAI(snssai).ih;
        const dnnPatch = {
          pduSessionTypes: {
            defaultSessionType: sessionType,
          },
          "5gQosProfile": {
            "5qi": fiveQi,
          },
          sessionAmbr: ambr, // ineffective without PCF
        };
        yield sql`INSERT dnn_configurations (supi,sst,dnn,json) VALUES (${supi},${sst},${dnn},JSON_MERGE_PATCH(@dnn_json,${dnnPatch}))`;
      }
    }
  }

  private async buildNSSF(): Promise<void> {
    const amfNSSAIs = new Set<string>();
    for (const amf of netdef.listAmfs(this.ctx.network)) {
      amf.nssai.sort(sortBy());
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
    for (const [i, amf] of netdef.listAmfs(this.ctx.network).entries()) {
      yield sql`INSERT nsi (nsi_id,nrf_id,target_amf_set) VALUES (${`nsi_id_${i}`},${`nrf_id_${i}`},${`${amf.amfi[1]}`}) RETURNING @nsi_id:=row_id`;
      for (const snssai of amf.nssai) {
        const { sst, sd = "" } = netdef.splitSNSSAI(snssai).ih;
        yield sql`INSERT snssai (sst,sd) VALUES (${sst},${sd}) RETURNING @snssai_id:=row_id`;
        yield "INSERT snssai_nsi_mapping (row_id_snssai,row_id_nsi) VALUES (@snssai_id,@nsi_id)";
      }
    }
  }

  private async buildAMF(amf: netdef.AMF): Promise<void> {
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
          { tac: Number.parseInt(this.ctx.network.tac, 16) },
        ],
      }];
      config.hacks.enable_reroute_nas = !!this.ctx.c.services.nssf;
    });
  }

  private async buildSMF(smf: netdef.SMF, startTeid: number): Promise<void> {
    const { nf, initCommands, makeDatabase } = await this.defineService(smf.name, ["db", "cp", "n4"], "5g/smf.json");
    setNrfClientSlices(nf, smf.nssai);

    await nf.editModule("smf", async ({ config }) => {
      Object.assign(config, this.plmn);
      await makeDatabase("5g/sql/smf_db.sql", config.Database, this.makeSMFDatabase());
      config.id = smf.name;
      config.mtu = 1456;
      config.startTeid = startTeid;
      if (this.opts["phoenix-pcf"]) {
        config.pcf_flag = 1;
      }
    });

    nf.editModule("sdn_routing_topology", ({ config }) => {
      config.Topology.Link = this.ctx.network.dataPaths.flatMap(([nodeA, nodeB, weight = 1]) => {
        const typeA = determineDataPathNodeType(nodeA);
        const typeB = determineDataPathNodeType(nodeB);
        const dn = typeA === "DNN" ? nodeA as N.DataNetworkID : typeB === "DNN" ? nodeB as N.DataNetworkID : undefined;
        if (dn && (!smf.nssai.includes(dn.snssai) || netdef.findDN(this.ctx.network, dn).type !== "IPv4")) {
          // DN not in SMF's NSSAI: skip
          // Ethernet DN: cannot appear in sdn_routing_topology because it has no N6
          return [];
        }
        return {
          weight,
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
    for (const { dnn, type, subnet } of this.ctx.network.dataNetworks) {
      yield sql`INSERT dnn (dnn) VALUES (${dnn}) RETURNING @dn_id:=dn_id`;
      if (type === "IPv4") {
        assert(!!subnet);
        const net = new Netmask(subnet);
        yield "INSERT dn_dns (dn_id,addr,ai_family) VALUES (@dn_id,'1.1.1.1',2)";
        yield sql`INSERT dn_info (dnn,network,prefix) VALUES (${dnn},${net.base},${net.bitmask})`;
      }
    }
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
        const gnb = findByName(node as string, netdef.listGnbs(this.ctx.network))!;
        return {
          type: "gNodeB",
          id: gnb.nci.gnb,
          ip: "255.255.255.255",
        };
      }
      case "UPF": {
        assert(typeof node === "string");
        return {
          type: "UPF",
          id: compose.getIP(this.ctx.c, node, "n4"),
          ip: compose.getIP(this.ctx.c, node, {
            DNN: "n6",
            gNodeB: "n3",
            UPF: "n9",
          }[peerType]),
        };
      }
    }
  }

  private async buildPCF(): Promise<void> {
    const { nf } = await this.defineService("pcf", ["cp"], "5g_af/pcf.json");
    nf.editModule("pcf", ({ config }) => {
      const smf = netdef.listSmfs(this.ctx.network)[0]!;
      config.sba.smf_server.addr = compose.getIP(this.ctx.c, smf.name, "cp");
    });
  }
}

function setNrfClientSlices(c: NetworkFunction, nssai: readonly N.SNSSAI[]): void {
  c.editModule("nrf_client", ({ config }) => {
    config.nf_profile.sNssais = nssai.map((snssai) => netdef.splitSNSSAI(snssai).ih);
  });
}

function determineDataPathNodeType(node: string | N.DataNetworkID): PH.sdn_routing_topology.Node["type"] {
  if (typeof node !== "string") {
    return "DNN";
  }
  return ({
    gnb: "gNodeB",
    upf: "UPF",
  } as const)[compose.nameToNf(node)]!;
}
