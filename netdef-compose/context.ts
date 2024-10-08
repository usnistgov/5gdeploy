import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import type { NetDef } from "../netdef/netdef.js";
import type { ComposeFile } from "../types/mod.js";

/** Contextual information and helpers while converting NetDef into Compose context. */
export class NetDefComposeContext extends compose.ComposeContext {
  /** Output Compose file. */
  public readonly c: ComposeFile = compose.create();

  /**
   * Constructor.
   * @param netdef - Input NetDef.
   * @param out - Output folder.
   * @param ipAlloc - IP address allocator.
   */
  constructor(
      public readonly netdef: NetDef,
      out: string,
      ipAlloc: compose.IPAlloc,
  ) {
    super(out, ipAlloc);
  }

  /** Access NetDef JSON. */
  public get network() {
    return this.netdef.network;
  }

  protected override makeComposeSh(): Iterable<string> {
    const { c } = this;
    return compose.makeComposeSh(c, {
      act: "web",
      desc: "View access instructions for web applications.",
      *code() {
        let count = 0;
        for (const [ct, net, port, title, tail] of [
          ["prometheus", "meas", 9090, "Prometheus", ""],
          ["grafana", "meas", 3000, "Grafana", "login with admin/grafana"],
          ["webui", "mgmt", 5000, "free5GC WebUI", "login with admin/free5gc"],
        ] satisfies Array<[string, string, number, string, string]>) {
          const ip = c.services[ct]?.annotations?.[`5gdeploy.ip_${net}`];
          if (!ip) {
            continue;
          }
          ++count;
          const msg = [`${title} is at ${ip}:${port}`];
          if (tail) {
            msg.push(tail);
          }
          yield `msg ${shlex.quote(msg.join(" , "))}`;
        }
        if (count > 0) {
          yield "msg Setup SSH port forwarding to access these services in a browser";
        } else {
          yield "msg No web application exists in this scenario";
        }
      },
    }, {
      act: "phoenix-register",
      desc: "Register Open5GCore UEs.",
      *code() {
        yield "for UECT in $(docker ps --filter='name=^ue' --format='{{.Names}}' | sort -n); do";
        yield "  msg Invoking Open5GCore UE registration and PDU session establishment in $UECT";
        yield "  $TSRUN/phoenix-rpc/main.ts --host=$UECT ue-register --dnn='*'";
        yield "done";
      },
    }, {
      act: "linkstat",
      desc: "Gather netif counters.",
      *code() {
        yield "$TSRUN/trafficgen/linkstat.ts --dir=$COMPOSE_CTX \"$@\"";
      },
    }, {
      act: "list-pdu",
      desc: "List PDU sessions.",
      *code() {
        yield "$TSRUN/trafficgen/list-pdu.ts --dir=$COMPOSE_CTX \"$@\"";
      },
    }, {
      act: "nmap",
      desc: "Run nmap ping scans from Data Network to UEs.",
      *code() {
        yield "$TSRUN/trafficgen/nmap.ts --dir=$COMPOSE_CTX \"$@\"";
      },
    }, {
      act: "nfd",
      cmd: "nfd --dnn=DNN",
      desc: "Deploy NDN Forwarding Daemon (NFD) between Data Network and UEs.",
      *code() {
        yield "$TSRUN/trafficgen/nfd.ts --dir=$COMPOSE_CTX \"$@\"";
      },
    }, {
      act: "tgcs",
      cmd: "tgcs FLAGS",
      desc: "Prepare client-server traffic generators.",
      *code() {
        yield "$TSRUN/trafficgen/tgcs.ts --dir=$COMPOSE_CTX \"$@\"";
      },
    });
  }
}
