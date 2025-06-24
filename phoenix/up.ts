import { compose, makeUPFRoutes, type netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { PH } from "../types/mod.js";
import { assert } from "../util/mod.js";
import { PhoenixScenarioBuilder } from "./builder.js";
import { type PhoenixOpts, tasksetScript } from "./options.js";

/** Build UP functions using Open5GCore as UPF. */
export async function phoenixUP(ctx: NetDefComposeContext, upf: netdef.UPF, opts: PhoenixOpts): Promise<void> {
  const b = new PhoenixUPBuilder(ctx, opts);
  await b.build(upf);
}

class PhoenixUPBuilder extends PhoenixScenarioBuilder {
  protected override nfKind = "up";

  public async build(upf: netdef.UPF): Promise<void> {
    await this.buildUPF(upf);
    await this.finish();
  }

  private async buildUPF({ name: ct, peers, nets }: netdef.UPF): Promise<void> {
    const nWorkers = this.opts["phoenix-upf-workers"];
    assert(nWorkers <= 8, "pfcp.so allows up to 8 threads");

    assert(peers.N6Ethernet.length <= 1, "UPF only supports one Ethernet DN");
    assert(peers.N6IPv6.length === 0, "UPF does not support IPv6 DN");

    const { s, nf, initCommands } = await this.defineService(ct, nets, "5g/upf1.json");
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
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
      ...Array.from(peers.N6IPv4, ({ subnet }) => `ip route replace ${subnet} dev n6_tun`),
      ...(peers.N6Ethernet.length > 0 ? [
        "ip link add name br-eth type bridge",
        "ip link set br-eth up",
        "ip tuntap add mode tap user root name n6_tap",
        "ip link set n6_tap up master br-eth",
      ] : []),
      ...makeUPFRoutes(this.ctx, peers),
      ...tasksetScript(s, this.opts["phoenix-upf-taskset"], nWorkers, "UPFSockFwd_"),
    );
  }
}
