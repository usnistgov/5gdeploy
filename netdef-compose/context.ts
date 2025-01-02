import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import type { ComposeFile, N } from "../types/mod.js";
import { tsrun } from "../util/cmd.js";

export const http2Port = 8582;

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
      public readonly network: N.Network,
      out: string,
      ipAlloc: compose.IPAlloc,
  ) {
    super(out, ipAlloc);
  }

  protected override makeComposeSh(): Iterable<string> {
    const { c } = this;
    return compose.makeComposeSh(c, {
      act: "web",
      desc: "View access instructions for web applications.",
      *code() {
        let count = 0;
        for (const [ct, net, port, title, tail, re] of [
          ["prometheus", "meas", 9090, "Prometheus", ""],
          ["grafana", "meas", 3000, "Grafana", "login with admin/grafana"],
          ["webui", "mgmt", 5000, "free5GC WebUI", "login with admin/free5gc", /free5gc/],
          ["webui", "mgmt", 9999, "Open5GS WebUI", "login with admin/1423", /open5gs/],
        ] satisfies ReadonlyArray<[string, string, number, string, string, RegExp?]>) {
          let ip: string;
          try {
            ip = compose.getIP(c, ct, net);
          } catch {
            continue;
          }
          if (re && !re.test(c.services[ct]!.image)) {
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
        yield `  ${tsrun("phoenix-rpc/main.ts")} --host=$UECT ue-register --dnn='*'`;
        yield "done";
      },
    }, {
      act: "linkstat",
      desc: "Gather netif counters.",
      *code() {
        yield `${tsrun("trafficgen/linkstat.ts")} --dir=$COMPOSE_CTX "$@"`;
      },
    }, {
      act: "list-pdu",
      desc: "List PDU sessions.",
      *code() {
        yield `${tsrun("trafficgen/list-pdu.ts")} --dir=$COMPOSE_CTX "$@"`;
      },
    }, {
      act: "nmap",
      desc: "Run nmap ping scans from Data Network to UEs.",
      *code() {
        yield `${tsrun("trafficgen/nmap.ts")} --dir=$COMPOSE_CTX "$@"`;
      },
    }, {
      act: "nfd",
      cmd: "nfd --dnn=DNN",
      desc: "Deploy NDN Forwarding Daemon (NFD) between Data Network and UEs.",
      *code() {
        yield `${tsrun("trafficgen/nfd.ts")} --dir=$COMPOSE_CTX "$@"`;
      },
    }, {
      act: "tgcs",
      cmd: "tgcs FLAGS",
      desc: "Prepare client-server traffic generators.",
      *code() {
        yield `${tsrun("trafficgen/tgcs.ts")} --dir=$COMPOSE_CTX "$@"`;
      },
    });
  }
}
