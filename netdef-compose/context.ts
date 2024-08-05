import type { Promisable } from "type-fest";

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

  /** Final steps. */
  public readonly finalize: Array<() => Promisable<void>> = [];

  /** Save compose.yml and compose.sh files. */
  public async saveTop(): Promise<void> {
    await this.writeFile("compose.yml", this.c);
    await this.writeFile("compose.sh", makeScript(this.c));
  }
}

function makeScript(c: ComposeFile): Iterable<string> {
  return compose.makeComposeSh(c, {
    act: "web",
    desc: "View access instructions for web applications.",
    *code() {
      yield "msg Prometheus is at $(yq '.services.prometheus.annotations[\"5gdeploy.ip_meas\"]' compose.yml):9090";
      yield "msg Grafana is at $(yq '.services.grafana.annotations[\"5gdeploy.ip_meas\"]' compose.yml):3000 , login with admin/grafana";
      yield "msg free5GC WebUI is at $(yq '.services.webui.annotations[\"5gdeploy.ip_mgmt\"]' compose.yml):5000 , login with admin/free5gc";
      yield "msg Setup SSH port forwarding to access these services in a browser";
      yield "msg \"'null'\" means the relevant service has been disabled";
    },
  }, {
    act: "phoenix-register",
    desc: "Register Open5GCore UEs.",
    *code() {
      yield "for UECT in $(docker ps --format='{{.Names}}' | grep '^ue' | sort -n); do";
      yield "  msg Invoking Open5GCore UE registration and PDU session establishment in $UECT";
      yield "  $TSRUN/phoenix-rpc/main.ts --host=$UECT ue-register --dnn='*'";
      yield "done";
    },
  }, {
    act: "linkstat",
    desc: "Gather netif counters.",
    *code() {
      yield "$TSRUN//trafficgen/linkstat.ts --dir=$COMPOSE_CTX \"$@\"";
    },
  }, {
    act: "list-pdu",
    desc: "List PDU sessions.",
    *code() {
      yield "$TSRUN//trafficgen/list-pdu.ts --dir=$COMPOSE_CTX \"$@\"";
    },
  }, {
    act: "nmap",
    desc: "Run nmap ping scans from Data Network to UEs.",
    *code() {
      yield "$TSRUN//trafficgen/nmap.ts --dir=$COMPOSE_CTX \"$@\"";
    },
  }, {
    act: "nfd",
    cmd: "nfd --dnn=DNN",
    desc: "Deploy NDN Forwarding Daemon (NFD) between Data Network and UEs.",
    *code() {
      yield "$TSRUN//trafficgen/nfd.ts --dir=$COMPOSE_CTX \"$@\"";
    },
  }, {
    act: "tgcs",
    cmd: "tgcs FLAGS",
    desc: "Prepare client-server traffic generators.",
    *code() {
      yield "$TSRUN//trafficgen/tgcs.ts --dir=$COMPOSE_CTX \"$@\"";
    },
  });
}
