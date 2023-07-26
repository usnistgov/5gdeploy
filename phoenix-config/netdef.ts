import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import sql from "sql-tagged-template-literal";

import { NetDef } from "../netdef/netdef.js";
import type * as N from "../types/netdef.js";
import type * as PH from "../types/phoenix.js";
import type { ScenarioFolder } from "./folder.js";
import type { IPMAP } from "./ipmap.js";
import { OtherTable } from "./other.js";

/** Apply network definition to scenario. */
export function applyNetdef(sf: ScenarioFolder, netdef: NetDef, only?: "core" | "ran"): void {
  new NetDefProcessor(netdef, sf).process(only);
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

  public process(only?: "core" | "ran"): void {
    if (!only || only === "core") {
      this.applyNSSF();
      this.applyUPF();
    }
  }

  private applyNSSF(): void {
    if (!this.sf.has("sql/nssf_db.sql")) {
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

      this.sf.initCommands.set(ct, [...(function*() {
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
      })()]);

      this.sf.routes.delete(ct);
      this.sf.routes.set(ct, { dest: OtherTable.DefaultDest, via: "$IGW_N6_IP" });
      for (const subnet of subnetsN6L3) {
        const dest = new Netmask(subnet);
        this.sf.routes.set(ct, { dest, dev: "n6_tun" });
        this.sf.routes.set("igw", { dest, via: this.ipmap.formatEnv(ct, "n6", "$") });
      }
    }
  }
}

function expandSNSSAI(snssai: N.SNSSAI): PH.SNSSAI {
  const { int: { sst }, hex: { sd } } = NetDef.splitSNSSAI(snssai);
  return { sst, sd };
}
