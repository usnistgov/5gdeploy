import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import SqlString from "sqlstring";

import { NetDef } from "../netdef/netdef.js";
import type * as N from "../types/netdef.js";
import type * as PH from "../types/phoenix.js";
import type { ScenarioFolder } from "./folder.js";
import { IPMAP } from "./ipmap.js";

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
    this.applyBT(f);
    this.applyAMF(f);
    this.applySMF(f);
    this.applyUPF(f);
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
        ({ gnb: config.gnb_id, ncgi: config.cell_id } = this.netdef.splitNCGI(gnb.ncgi));
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

        config.Cell.splice(0, Infinity, ...this.network.gnbs.map((gnb): PH.ue_5g_nas_only.Cell => {
          const ip = `%${gnb.name.toUpperCase()}_AIR_IP`;
          return {
            cell_id: this.netdef.splitNCGI(gnb.ncgi).ncgi,
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

  private applyBT(f: ScenarioFolder): void {
    for (const ct of f.ipmap.containers.keys()) {
      if (["bt", "btup"].includes(IPMAP.toNf(ct))) {
        f.ipmap.removeContainer(ct);
        f.files.delete(`${ct}.json`);
      }
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

    f.editNetworkFunction("smf", (c) => {
      const { config } = c.getModule("pfcp");
      config.Associations.Peer.splice(0, Infinity, ...this.network.upfs.map((upf): PH.pfcp.Acceptor => ({
        type: "udp",
        port: 8805,
        bind: `%${upf.name.toUpperCase()}_N4_IP`,
      })));
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
        return {
          type: "gNodeB",
          id: this.netdef.splitNCGI(gnb.ncgi).gnb,
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

  private applyUPF(f: ScenarioFolder): void {
    for (const [ct, upf] of f.resizeNetworkFunction("upf", this.network.upfs)) {
      f.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("pfcp");
        assert(config.mode === "UP");
        assert(config.data_plane_mode === "integrated");

        let hasN3 = false;
        let hasN9 = false;
        let hasN6L3 = false;
        delete config.ethernet_session_identifier;
        for (let link of this.network.dataPaths.links) {
          link = NetDef.normalizeDataPathLink(link);
          const peer = link.a === upf.name ? link.b : link.b === upf.name ? link.a : undefined;
          if (peer === undefined) {
            continue;
          }
          if (typeof peer === "string") {
            hasN3 ||= this.netdef.findGNB(peer) !== undefined;
            hasN9 ||= this.netdef.findUPF(peer) !== undefined;
          } else {
            const dn = this.network.dataNetworks.find((dn) => dn.snssai === peer.snssai && dn.dnn === peer.dnn);
            assert(dn);
            switch (dn.type) {
              case "Ethernet": {
                assert(config.ethernet_session_identifier === undefined, "UPF only supports one Ethernet DN");
                config.ethernet_session_identifier = dn.dnn;
                break;
              }
              case "IPv4": {
                hasN6L3 = true;
              }
            }
          }
        }

        config.DataPlane.interfaces.splice(0, Infinity);
        if (hasN3) {
          config.DataPlane.interfaces.push({
            type: "n3_n9",
            name: `%${ct.toUpperCase()}_N3_IF`,
            bind_ip: `%${ct.toUpperCase()}_N3_IP`,
            mode: "single_thread",
          });
        }
        if (hasN9) {
          config.DataPlane.interfaces.push({
            type: "n3_n9",
            name: `%${ct.toUpperCase()}_N9_IF`,
            bind_ip: `%${ct.toUpperCase()}_N9_IP`,
            mode: "thread_pool",
          });
        }
        if (hasN6L3) {
          config.DataPlane.interfaces.push({
            type: "n6_l3",
            name: "n6_tun",
            bind_ip: `%${ct.toUpperCase()}_N6_IP`,
            mode: "thread_pool",
          });
        }
        if (config.ethernet_session_identifier) {
          config.DataPlane.interfaces.push({
            type: "n6_l2",
            name: "n6_eth",
            mode: "thread_pool",
          });
        }
        assert(config.DataPlane.interfaces.length <= 8);
        delete config.DataPlane.xdp;
      });
    }
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
