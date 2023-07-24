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
  private readonly usim = { sqn: "000000000001", amf: "8000" } as const;

  public process(only?: "core" | "ran"): void {
    this.applyEnv();
    if (!only || only === "ran") {
      this.applyGNBs();
      this.applyUEs();
    }
    if (!only || only === "core") {
      this.applyNSSF();
      this.applyAMF();
      this.applyUPF();
      this.applyUDM();
    }
  }

  private applyEnv(): void {
    const [mcc, mnc] = NetDef.splitPLMN(this.network.plmn);
    assert(mnc.length === 2, "Open5GCore only supports 2-digit MNC");
    this.sf.env.set("MCC", mcc);
    this.sf.env.set("MNC", mnc);
    this.sf.env.set("PROMETHEUS_ENABLED", "0");
    this.sf.env.set("COMMAND_DISABLED", "0");
    this.sf.env.set("DISABLE_REMOTE_COMMAND", "0");
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
      this.sf.initCommands.set(ct, [
        "iptables -I OUTPUT -p icmp --icmp-type destination-unreachable -j DROP",
      ]);
    }
  }

  private applyUEs(): void {
    const allGNBs = this.network.gnbs.map((gnb) => gnb.name);
    for (const [ct, subscriber] of this.sf.scaleNetworkFunction(["ue1", "ue0"], this.network.subscribers)) {
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
      this.sf.initCommands.set(ct, [
        "ip link set air mtu 1470",
      ]);
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

  private applyAMF(): void {
    for (const [ct, amf] of this.sf.scaleNetworkFunction(["amf", "amf1"], this.network.amfs)) {
      this.sf.editNetworkFunction(ct,
        (c) => this.setNrfClientSlices(c, amf.nssai),
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

  private setNrfClientSlices(c: NetworkFunction, nssai: readonly N.SNSSAI[] = this.netdef.nssai): void {
    const { config } = c.getModule("nrf_client");
    config.nf_profile.sNssais.splice(0, Infinity, ...nssai.map((snssai) => expandSNSSAI(snssai)));
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
