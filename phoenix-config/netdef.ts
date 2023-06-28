import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import SqlString from "sqlstring";

import { NetDef } from "../netdef/netdef.js";
import type * as N from "../types/netdef.js";
import type * as PH from "../types/phoenix.js";
import type { ScenarioFolder } from "./folder.js";

/** Apply network definition to scenario. */
export function applyNetdef(f: ScenarioFolder, netdef: NetDef): void {
  new NetDefProcessor(netdef).applyTo(f);
}

class NetDefProcessor {
  constructor(
      private readonly netdef: NetDef,
  ) {
    this.network = this.netdef.network;
  }

  private readonly network: N.Network;
  private readonly usim = { sqn: "000000000001", amf: "8000" } as const;

  public applyTo(f: ScenarioFolder): void {
    this.applyEnv(f);
    this.applyGNBs(f);
    this.applyUEs(f);
    this.applyAMF(f);
    this.applySMF(f);
    this.applyUDM(f);
  }

  private applyEnv(f: ScenarioFolder): void {
    const [mcc, mnc] = NetDef.splitPLMN(this.network.plmn);
    f.env.set("MCC", mcc);
    f.env.set("MNC", mnc);
    f.env.set("PROMETHEUS_ENABLED", "0");
  }

  private applyGNBs(f: ScenarioFolder): void {
    for (const [ct, gnb] of f.resizeNetworkFunction("gnb", this.network.gnbs)) {
      f.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("gnb");
        delete config.amf_addr;
        delete config.amf_port;
        config.amf_list = [
          { ngc_addr: "%AMF_N2_IP", ngc_sctp_port: 38412 },
        ];
        config.mcc = "%MCC";
        config.mnc = "%MNC";
        [config.gnb_id, config.cell_id] = this.netdef.splitNCGI(gnb.ncgi);
        config.tac = this.netdef.tac;
      });
    }
  }

  private applyUEs(f: ScenarioFolder): void {
    for (const [ct, subscriber] of f.resizeNetworkFunction("ue", this.network.subscribers)) {
      f.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("ue_5g_nas_only");
        config.usim = {
          supi: subscriber.supi,
          k: subscriber.k,
          amf: this.usim.amf,
          opc: subscriber.opc,
          start_sqn: this.usim.sqn,
        };
        delete config["usim-test-vector19"];
        config.dn_list.splice(0, Infinity, ...this.network.dataNetworks.flatMap((dn): PH.ue_5g_nas_only.DN[] => {
          if (dn.type === "IPv6" || subscriber.requestedNSSAI?.includes(dn.snssai) === false) {
            return [];
          }
          return [{
            dnn: dn.dnn,
            dn_type: dn.type,
          }];
        }));
        config.DefaultNetwork.dnn = config.dn_list[0]?.dnn ?? "default";
        config.Cell.splice(0, Infinity, ...this.network.gnbs.map((gnb): PH.ue_5g_nas_only.Cell => {
          const ip = `%${gnb.name.toUpperCase()}_AIR_IP`;
          const [, cell_id] = this.netdef.splitNCGI(gnb.ncgi);
          return {
            cell_id,
            mcc: "%MCC",
            mnc: "%MNC",
            gnb_cp_addr: ip,
            gnb_up_addr: ip,
            gnb_port: 10000,
          };
        }));
      });
    }
  }

  private applyAMF(f: ScenarioFolder): void {
    f.editNetworkFunction("amf", (c) => {
      const { config } = c.getModule("amf");
      config.trackingArea.splice(0, Infinity, {
        mcc: "%MCC",
        mnc: "%MNC",
        taiList: [
          { tac: this.netdef.tac },
        ],
      });
    });
  }

  private applySMF(f: ScenarioFolder): void {
    const { network } = this;

    f.editNetworkFunction("smf", (c) => {
      const { config } = c.getModule("sdn_routing_topology");
      config.Topology.Link = this.network.dataPaths.links.map((link) => {
        const { a: nodeA, b: nodeB, cost = 1 } = NetDef.normalizeDataPathLink(link);
        const typeA = this.determineDataPathNodeType(nodeA);
        const typeB = this.determineDataPathNodeType(nodeB);
        return {
          weight: cost,
          Node_A: this.makeDataPathTopoNode(nodeA, typeA, typeB),
          Node_B: this.makeDataPathTopoNode(nodeB, typeB, typeA),
        };
      });
    });

    f.appendSQL("smf_db", function*() {
      yield "DELETE FROM dn_dns";
      yield "DELETE FROM dn_info";
      yield "DELETE FROM dn_ipv4_allocations";
      yield "DELETE FROM dnn";
      yield* network.dataNetworks.map(function*({ dnn, type, subnet }) {
        yield SqlString.format("INSERT dnn (dnn) VALUES (?) RETURNING @dnid := dn_id", [dnn]);
        if (type === "IPv4") {
          assert(!!subnet);
          const net = new Netmask(subnet);
          yield SqlString.format("INSERT dn_dns (dn_id,addr,ai_family) VALUES (@dnid,?,?)", ["1.1.1.1", 2]);
          yield SqlString.format("INSERT dn_info (dnn,network,prefix) VALUES (?,?,?)", [dnn, net.base, net.bitmask]);
        }
      });
    });
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
    throw new Error("data path node not found");
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
        const [id] = this.netdef.splitNCGI(gnb.ncgi);
        return {
          type: "gNodeB",
          id,
          ip: "255.255.255.255",
        };
      }
    }

    const upf = this.netdef.findUPF(node as string)!;
    return {
      type: "UPF",
      id: `%${upf.name.toUpperCase()}_N4_IP`,
      ip: `%${upf.name.toUpperCase()}_${{
        DNN: "N6",
        gNodeB: "N3",
        UPF: "N9",
      }[peerType]}_IP`,
    };
  }

  private applyUDM(f: ScenarioFolder): void {
    const { network, usim } = this;

    f.appendSQL("udm_db", function*() {
      yield SqlString.format("SELECT @dnn_json := json FROM dnn_configurations WHERE supi=? LIMIT 1", ["default_data"]);
      yield "DELETE FROM dnn_configurations";
      yield* network.dataNetworks.map(function*({ dnn, snssai }) {
        const [sst] = NetDef.splitSNSSAI(snssai);
        yield SqlString.format("INSERT dnn_configurations (supi,sst,dnn,json) VALUES (?,?,?,@dnn_json)",
          ["default_data", Number.parseInt(sst, 16), dnn]);
      });
    });

    f.appendSQL("udm_db", function*() {
      yield "DELETE FROM supi";
      yield* network.subscribers.map(function*({ supi, k, opc }) {
        yield SqlString.format(
          "INSERT supi (identity,k,amf,op,sqn,auth_type,op_is_opc,usim_type) VALUES (?,UNHEX(?),UNHEX(?),UNHEX(?),UNHEX(?),?,?,?)",
          [supi, k, usim.amf, opc, usim.sqn, 0, 1, 0]);
      });
    });
  }
}
