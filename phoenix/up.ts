import { compose, makeUPFRoutes, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { N, PH } from "../types/mod.js";
import { assert } from "../util/mod.js";
import { PhoenixScenarioBuilder } from "./builder.js";
import { type PhoenixOpts, tasksetScript } from "./options.js";

/** Build UP functions using Open5GCore as UPF. */
export async function phoenixUP(ctx: NetDefComposeContext, upf: N.UPF, opts: PhoenixOpts): Promise<void> {
  const b = new PhoenixUPBuilder(ctx, opts);
  await b.buildUPF(upf);
  await b.finish();
}

class PhoenixUPBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "up";

  public async buildUPF(upf: N.UPF): Promise<void> {
    const ct = upf.name;
    const nWorkers = this.opts["phoenix-upf-workers"];
    assert(nWorkers <= 8, "pfcp.so allows up to 8 threads");

    const peers = netdef.gatherUPFPeers(this.ctx.network, upf);
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
