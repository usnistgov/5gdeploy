import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import sql from "sql-tagged-template-literal";

import { NetDef } from "../netdef/netdef.js";
import type * as N from "../types/netdef.js";
import type * as PH from "../types/phoenix.js";
import type { ScenarioFolder } from "./folder.js";
import type { IPMAP } from "./ipmap.js";
import type { NetworkFunction } from "./nf.js";
import { OtherTable } from "./other.js";

/** Apply network definition to scenario. */
export function applyNetdef(sf: ScenarioFolder, netdef: NetDef): void {
  new NetDefProcessor(netdef, sf).process();
}

class NetDefProcessor {
  constructor(
      private readonly netdef: NetDef,
      private readonly sf: ScenarioFolder,
  ) {
    this.network = this.netdef.network;
    this.ipmap = this.sf.ipmap;
  }

  private readonly network: N.Network;
  private readonly ipmap: IPMAP;
  private readonly usim = { sqn: "000000000001", amf: "8000" } as const;

  public process(): void {
    this.applyEnv();
    this.applyGNBs();
    this.applyUEs();
    this.applyBT();
    this.applyNSSF();
    this.applyAMF();
    this.applySMF();
    this.applyUPF();
    this.applyUDM();
  }

  private applyEnv(): void {
    const [mcc, mnc] = NetDef.splitPLMN(this.network.plmn);
    assert(mnc.length === 2, "Open5GCore only supports 2-digit MNC");
    this.sf.env.set("MCC", mcc);
    this.sf.env.set("MNC", mnc);
    this.sf.env.set("PROMETHEUS_ENABLED", "0");
  }

  private applyGNBs(): void {
    const sliceKeys = ["slice", "slice2"] as const;
    const slices = this.netdef.nssai.map((snssai) => expandSNSSAI(snssai));
    assert(slices.length <= sliceKeys.length, `gNB allows up to ${sliceKeys.length} slices`);

    for (const [ct, gnb] of this.sf.scaleNetworkFunction("gnb1", this.network.gnbs)) {
      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("gnb");
        delete config.amf_addr;
        delete config.amf_port;
        config.amf_list = this.network.amfs.map((amf): PH.gnb.AMF => ({
          ngc_addr: this.ipmap.formatEnv(amf.name, "n2"),
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
    }
  }

  private applyUEs(): void {
    const allGNBs = this.network.gnbs.map((gnb) => gnb.name);
    for (const [ct, subscriber] of this.sf.scaleNetworkFunction("ue1", this.network.subscribers)) {
      this.sf.editNetworkFunction(ct, (c) => {
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

        config.Cell.splice(0, Infinity, ...(subscriber.gnbs ?? allGNBs).map((name): PH.ue_5g_nas_only.Cell => {
          const ip = this.ipmap.formatEnv(name, "air");
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
    }
  }

  private applyBT(): void {
    for (const nf of ["bt", "btup"]) {
      for (const ct of this.ipmap.listContainersByNf(nf)) {
        this.ipmap.removeContainer(ct);
        this.sf.delete(`${ct}.json`);
      }
    }
  }

  private applyNSSF(): void {
    if (!this.sf.hasFile("sql/nssf_db.sql")) {
      return;
    }
    const { netdef, network } = this;

    this.sf.appendSQL("nssf_db", function*() {
      yield "DELETE FROM snssai_nsi_mapping";
      yield "DELETE FROM nsi";
      yield "DELETE FROM snssai";
      for (const [i, amf] of network.amfs.entries()) {
        const [, set] = NetDef.validateAMFI(amf.amfi);
        yield sql`INSERT nsi (nsi_id,nrf_id,target_amf_set) VALUES (${`nsi_id_${i}`},${`nrf_id_${i}`},${`${set}`}) RETURNING @nsi_id:=row_id`;
        for (const snssai of amf.nssai ?? netdef.nssai) {
          const { sst, sd = "" } = expandSNSSAI(snssai);
          yield sql`INSERT snssai (sst,sd) VALUES (${sst},${sd}) RETURNING @snssai_id:=row_id`;
          yield "INSERT snssai_nsi_mapping (row_id_snssai,row_id_nsi) VALUES (@snssai_id,@nsi_id)";
        }
      }
    });
  }

  private applyAMF(): void {
    for (const [ct, amf] of this.sf.scaleNetworkFunction(["amf", "amf1"], this.network.amfs)) {
      this.sf.editNetworkFunction(ct, (c) => this.setNrfClientSlices(c, amf.nssai));
      this.sf.editNetworkFunction(ct, (c) => {
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
      });
    }
  }

  private applySMF(): void {
    const { network } = this;
    let nextTeid = 0x10000000;
    const eachTeid = Math.floor(0xE0000000 / network.smfs.length);
    for (const [ct, smf] of this.sf.scaleNetworkFunction(["smf", "smf1"], network.smfs)) {
      const startTeid = nextTeid;
      nextTeid += eachTeid;

      this.sf.editNetworkFunction(ct, (c) => this.setNrfClientSlices(c, smf.nssai));

      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("smf");
        config.id = ct;
        config.mtu = 1456;
        config.startTeid = startTeid;
      });

      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("sdn_routing_topology");
        config.Topology.Link = this.netdef.dataPathLinks.flatMap(({ a: nodeA, b: nodeB, cost }) => {
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
      });

      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("pfcp");
        config.Associations.Peer.splice(0, Infinity, ...this.network.upfs.map((upf): PH.pfcp.Acceptor => ({
          type: "udp",
          port: 8805,
          bind: this.ipmap.formatEnv(upf.name, "n4"),
        })));
      });
    }

    this.sf.appendSQL("smf_db", function*() {
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
  }

  private setNrfClientSlices(c: NetworkFunction, nssai: readonly N.SNSSAI[] = this.netdef.nssai): void {
    const { config } = c.getModule("nrf_client");
    config.nf_profile.sNssais.splice(0, Infinity, ...nssai.map((snssai) => expandSNSSAI(snssai)));
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
          id: this.netdef.splitNCI(gnb.nci).gnb,
          ip: "255.255.255.255",
        };
      }
    }

    const upf = this.netdef.findUPF(node as string)!;
    return {
      type: "UPF",
      id: this.ipmap.formatEnv(upf.name, "n4"),
      ip: this.ipmap.formatEnv(upf.name, {
        DNN: "n6",
        gNodeB: "n3",
        UPF: "n9",
      }[peerType]),
    };
  }

  private applyUPF(): void {
    this.sf.routes.delete("igw");
    this.sf.routes.set("igw", { dest: OtherTable.DefaultDest, via: "$HOSTNAT_HNET_IP" });
    for (const [ct, upf] of this.sf.scaleNetworkFunction("upf1", this.network.upfs)) {
      let hasN3 = false;
      let hasN9 = false;
      const subnetsN6L3: string[] = [];
      let dnnN6L2: string | undefined;
      for (const [peer] of this.netdef.listDataPathPeers(upf.name)) {
        if (typeof peer === "string") {
          hasN3 ||= !!this.netdef.findGNB(peer);
          hasN9 ||= !!this.netdef.findUPF(peer);
        } else {
          const dn = this.netdef.findDN(peer);
          assert(!!dn);
          switch (dn.type) {
            case "Ethernet": {
              assert(!dnnN6L2, "UPF only supports one Ethernet DN");
              dnnN6L2 = dn.dnn;
              break;
            }
            case "IPv4": {
              subnetsN6L3.push(dn.subnet!);
              break;
            }
          }
        }
      }

      this.sf.editNetworkFunction(ct, (c) => {
        const { config } = c.getModule("pfcp");
        assert(config.mode === "UP");
        assert(config.data_plane_mode === "integrated");
        config.ethernet_session_identifier = dnnN6L2;
        config.DataPlane.interfaces.splice(0, Infinity);
        if (hasN3) {
          config.DataPlane.interfaces.push({
            type: "n3_n9",
            name: "n3",
            bind_ip: this.ipmap.formatEnv(ct, "n3"),
            mode: "single_thread",
          });
        }
        if (hasN9) {
          config.DataPlane.interfaces.push({
            type: "n3_n9",
            name: "n9",
            bind_ip: this.ipmap.formatEnv(ct, "n9"),
            mode: "thread_pool",
          });
        }
        if (subnetsN6L3.length > 0) {
          config.DataPlane.interfaces.push({
            type: "n6_l3",
            name: "n6_tun",
            bind_ip: this.ipmap.formatEnv(ct, "n6"),
            mode: "thread_pool",
          });
        }
        if (dnnN6L2) {
          config.DataPlane.interfaces.push({
            type: "n6_l2",
            name: "n6_tap",
            mode: "thread_pool",
          });
        }
        assert(config.DataPlane.interfaces.length <= 8, "pfcp.so allows up to 8 interfaces");
        delete config.DataPlane.xdp;
      });

      this.sf.initCommands.get(ct).splice(0, Infinity, ...(function*() {
        if (subnetsN6L3.length > 0 || dnnN6L2) {
          yield "ip link set n6 mtu 1456";
        }
        if (subnetsN6L3.length > 0) {
          yield "ip tuntap add mode tun user root name n6_tun";
          yield "ip link set n6_tun up";
        }
        if (dnnN6L2) {
          yield "ip link add name br-eth type bridge";
          yield "ip link set br-eth up";
          yield "ip tuntap add mode tap user root name n6_tap";
          yield "ip link set n6_tap up master br-eth";
        }
      })());

      this.sf.routes.delete(ct);
      this.sf.routes.set(ct, { dest: OtherTable.DefaultDest, via: "$IGW_N6_IP" });
      for (const subnet of subnetsN6L3) {
        const dest = new Netmask(subnet);
        this.sf.routes.set(ct, { dest, dev: "n6_tun" });
        this.sf.routes.set("igw", { dest, via: this.ipmap.formatEnv(ct, "n6", "$") });
      }
    }
  }

  private applyUDM(): void {
    const { netdef, network, usim } = this;
    const dfltSubscribedNSSAI = netdef.nssai.map((snssai): N.SubscriberSNSSAI => ({
      snssai,
      dnns: network.dataNetworks.filter((dn) => dn.snssai === snssai).map((dn) => dn.dnn),
    }));

    this.sf.appendSQL("udm_db", function*() {
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
          VALUES (${supi},UNHEX(${k}),UNHEX(${usim.amf}),UNHEX(${opc}),UNHEX(${usim.sqn}),0,1,0)
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
  }
}

function expandSNSSAI(snssai: N.SNSSAI): PH.SNSSAI {
  const [sstHex, sd] = NetDef.splitSNSSAI(snssai);
  const sst = Number.parseInt(sstHex, 16);
  return sd === undefined ? { sst } : { sst, sd };
}
