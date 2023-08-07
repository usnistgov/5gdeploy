import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import * as shlex from "shlex";
import { collect, take } from "streaming-iterables";

import { NetDef } from "../netdef/netdef.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import { phoenixUP } from "../netdef-compose/phoenix.js";
import type * as N from "../types/netdef.js";
import type * as OAI from "../types/oai.js";
import * as oai_conf from "./conf.js";

const TAG = await oai_conf.getTag();
const vppScript = await fs.readFile(fileURLToPath(new URL("upf-vpp.sh", import.meta.url)));

/**
 * Build UP functions using oai-spgwu-tiny as UPF.
 * Currently this is incompatible with Open5GCore SMF.
 */
export async function buildUPtiny(ctx: NetDefComposeContext): Promise<void> {
  await phoenixUP(ctx);

  for (const upf of ctx.network.upfs) {
    const s = ctx.c.services[upf.name];
    assert(!!s);
    await fs.unlink(path.resolve(ctx.out, `up-cfg/${upf.name}.json`));
    const phoenixVolumeIndex = s.volumes.findIndex((volume) => volume.target.startsWith("/opt/phoenix"));
    assert(phoenixVolumeIndex >= 0);
    s.volumes.splice(phoenixVolumeIndex, 1);

    s.image = "oaisoftwarealliance/oai-spgwu-tiny:v1.5.1";
    // encode the command so that oai_spgwu does not detect the entrypoint script as "redundant process"
    const cmd = [
      "cat /openair-spgwu-tiny/etc/spgw_u.conf",
      "/openair-spgwu-tiny/bin/oai_spgwu -c /openair-spgwu-tiny/etc/spgw_u.conf -o",
    ].join("\n");
    s.command = ["sh", "-c", `echo ${shlex.quote(Buffer.from(cmd).toString("base64"))} | base64 -d | sh`];

    s.environment = {
      TZ: "Etc/UTC",
      SGW_INTERFACE_NAME_FOR_S1U_S12_S4_UP: "eth1", // n3
      SGW_INTERFACE_NAME_FOR_SX: "eth2", // n4
      PGW_INTERFACE_NAME_FOR_SGI: "eth3", // n6
      NETWORK_UE_IP: "255.255.255.255/32",
      ENABLE_5G_FEATURES: "yes",
      REGISTER_NRF: "no",
      NRF_IPV4_ADDRESS: "255.255.255.255",
      UPF_FQDN_5G: "",
    };

    let i = 0;
    const subnets: Netmask[] = [];
    for (const [peer] of ctx.netdef.listDataPathPeers(upf.name)) {
      if (typeof peer === "string") {
        continue;
      }
      const dn = ctx.netdef.findDN(peer);
      assert(!!dn);
      if (dn.type !== "IPv4") {
        continue;
      }

      assert(i < 4, `UPF ${upf.name} can handle up to 4 DNs`);
      const { int: { sst }, hex: { sd = "FFFFFF" } } = NetDef.splitSNSSAI(dn.snssai);
      s.environment[`NSSAI_SST_${i}`] = `${sst}`;
      s.environment[`NSSAI_SD_${i}`] = `0x${sd}`;
      s.environment[`DNN_${i}`] = dn.dnn;
      ++i;

      subnets.push(new Netmask(dn.subnet!));
    }

    if (subnets.length > 0) {
      let ueSubnet = new Netmask(`${subnets[0]}`);
      const isCovered = (subnet: Netmask) => ueSubnet.contains(subnet);
      while (ueSubnet.bitmask > 8 && !subnets.every(isCovered)) {
        ueSubnet = new Netmask(ueSubnet.base, ueSubnet.bitmask - 1);
      }
      s.environment.NETWORK_UE_IP = ueSubnet.toString();
    }
  }
}

/**
 * Build UP functions using oai-upf-vpp as UPF.
 * Currently this can create association Open5GCore SMF, but cannot pass traffic.
 */
export async function buildUPvpp(ctx: NetDefComposeContext): Promise<void> {
  await phoenixUP(ctx);
  const [mcc, mnc] = NetDef.splitPLMN(ctx.network.plmn);
  await ctx.writeFile("oai-upf-vpp.sh", vppScript);

  for (const upf of ctx.network.upfs) {
    const s = ctx.c.services[upf.name];
    assert(!!s);
    await fs.unlink(path.resolve(ctx.out, `up-cfg/${upf.name}.json`));
    const phoenixVolumeIndex = s.volumes.findIndex((volume) => volume.target.startsWith("/opt/phoenix"));
    assert(phoenixVolumeIndex >= 0);
    s.volumes.splice(phoenixVolumeIndex, 1, {
      type: "bind",
      source: "./oai-upf-vpp.sh",
      target: "/upf-vpp.sh",
      read_only: true,
    });

    s.privileged = true;
    s.image = "oaisoftwarealliance/oai-upf-vpp:v1.5.1";
    s.command = ["/bin/bash", "/upf-vpp.sh"];
    s.environment = {
      NAME: s.hostname,
      MCC: mcc,
      MNC: mnc,
      REALM: "3gppnetwork.org",
      VPP_MAIN_CORE: "0",
      VPP_CORE_WORKER: "1",
      VPP_PLUGIN_PATH: "/usr/lib/x86_64-linux-gnu/vpp_plugins/",
      REGISTER_NRF: "no",
    };

    for (const [i, net] of ["n3", "n4", "n6", "n9"].entries()) {
      s.environment[`IF_${1 + i}_IP`] = s.networks[net]!.ipv4_address;
      s.environment[`IF_${1 + i}_TYPE`] = net.toUpperCase();
      s.environment[`IF_${1 + i}_NWI`] = `nwi${1 + i}.oai.org`;
    }

    for (const [peer] of ctx.netdef.listDataPathPeers(upf.name)) {
      if (typeof peer === "string") {
        continue;
      }
      const dn = ctx.netdef.findDN(peer);
      assert(!!dn);
      if (dn.type !== "IPv4") {
        continue;
      }

      assert(!s.environment.DNN, `UPF ${upf.name} must handle exactly 1 DN`);
      const { int: { sst, sd = 0xFFFFFF } } = NetDef.splitSNSSAI(dn.snssai);
      s.environment.SNSSAI_SST = sst.toString();
      s.environment.SNSSAI_SD = sd.toString();
      s.environment.DNN = dn.dnn;
    }
    assert(s.environment.DNN, `UPF ${upf.name} must handle exactly 1 DN`);
  }
}

/** Define gNB container and generate configuration */
export async function makeGNB(ctx: NetDefComposeContext, ct: string, gnb: N.GNB): Promise<void> {
  const s = ctx.defineService(ct, `oaisoftwarealliance/oai-gnb:${TAG}`, ["air", "n2", "n3"]);

  const c = (await oai_conf.loadTemplate("gnb.sa.band78.106prb.rfsim")) as OAI.gnb.Config;
  c.Active_gNBs.splice(0, Infinity, gnb.name);

  assert(c.gNBs.length === 1);
  const g0 = c.gNBs[0]!;
  ({ gnb: g0.gNB_ID, nci: g0.nr_cellid } = ctx.netdef.splitNCI(gnb.nci));
  g0.gNB_name = gnb.name;
  g0.tracking_area_code = ctx.netdef.tac;

  const [mcc, mnc] = NetDef.splitPLMN(ctx.netdef.network.plmn);
  g0.plmn_list = [{
    mcc: Number.parseInt(mcc, 16),
    mnc: Number.parseInt(mnc, 16),
    mnc_length: mnc.length,
    snssaiList: ctx.netdef.nssai.map((snssai): OAI.gnb.SNSSAI => NetDef.splitSNSSAI(snssai).int),
    "snssaiList:dtype": "l",
  }];

  g0.amf_ip_address = ctx.gatherIPs("amf", "n2").slice(0, 1).map((ip): OAI.gnb.AMF => ({
    ipv4: ip,
    ipv6: "100::",
    active: "yes",
    preference: "ipv4",
  }));
  g0.NETWORK_INTERFACES = {
    GNB_INTERFACE_NAME_FOR_NG_AMF: "eth1",
    GNB_IPV4_ADDRESS_FOR_NG_AMF: s.networks.n2!.ipv4_address,
    GNB_INTERFACE_NAME_FOR_NGU: "eth2",
    GNB_IPV4_ADDRESS_FOR_NGU: s.networks.n3!.ipv4_address,
    GNB_PORT_FOR_S1U: 2152,
  };

  c.log_config = {
    global_log_level: "info",
    ngap_log_level: "debug",
    nr_mac_log_level: "warn",
    phy_log_level: "warn",
  };

  await ctx.writeFile(`ran-oai/${ct}.conf`, await oai_conf.save(c));

  s.privileged = true;
  s.environment = {
    USE_ADDITIONAL_OPTIONS: "--sa -E --rfsim",
  };
  s.volumes = [
    { type: "bind", source: `./ran-oai/${ct}.conf`, target: "/opt/oai-gnb/etc/gnb.conf", read_only: true },
  ];
}

/** Define UE container and generate configuration. */
export async function makeUE(ctx: NetDefComposeContext, ct: string, subscriber: N.Subscriber): Promise<void> {
  const s = ctx.defineService(ct, `oaisoftwarealliance/oai-nr-ue:${TAG}`, ["air"]);

  const c = (await oai_conf.loadTemplate("nrue.uicc")) as OAI.ue.Config;
  const [, mnc] = NetDef.splitPLMN(ctx.netdef.network.plmn);
  c.uicc0 = {
    imsi: subscriber.supi,
    nmc_size: mnc.length,
    key: subscriber.k,
    opc: subscriber.opc,
    dnn: "",
    nssai_sst: 0,
  };
  const [dn] = collect(take(1, ctx.netdef.listSubscriberDNs(subscriber, true)));
  if (dn) {
    c.uicc0.dnn = dn.dnn;
    ({ sst: c.uicc0.nssai_sst, sd: c.uicc0.nssai_sd } = NetDef.splitSNSSAI(dn.snssai).int);
  }

  c.rfsimulator = {
    serveraddr: ctx.gatherIPs("gnb", "air")[0]!,
  };

  c.log_config = {
    global_log_level: "info",
    ngap_log_level: "debug",
    nr_phy_log_level: "error",
    phy_log_level: "warn",
  };

  await ctx.writeFile(`ran-oai/${ct}.conf`, await oai_conf.save(c));

  s.privileged = true;
  s.environment = {
    USE_ADDITIONAL_OPTIONS: "-E --sa --rfsim -r 106 --numerology 1 -C 3619200000",
  };
  s.volumes = [
    { type: "bind", source: `./ran-oai/${ct}.conf`, target: "/opt/oai-nr-ue/etc/nr-ue.conf", read_only: true },
  ];
}
