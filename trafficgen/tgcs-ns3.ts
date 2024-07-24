import { ip2long, long2ip } from "netmask";
import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { scriptCleanup } from "../util/mod.js";
import { Direction, type TrafficGen } from "./tgcs-defs.js";

const rngSeed = Math.floor(Math.random() * 0x100000000);

function* iptablesInsertWithCleanup(table: string, chain: string, flags: string): Iterable<string> {
  yield `iptables -t ${table} -I ${chain} ${flags}`;
  yield `CLEANUPS=$CLEANUPS"; iptables -t ${table} -D ${chain} ${flags}"`;
}

function setupNs3(
    s: ComposeService, index: number, hostIP: string,
    ports: ReadonlyArray<`${"tcp" | "udp"}:${number}`>,
    commandLine: readonly string[],
): void {
  s.cap_add.push("NET_ADMIN");
  s.devices.push("/dev/net/tun:/dev/net/tun");

  const tapNetif = `ns3tap${index}`;
  const tapNetwork = ip2long("172.23.0.0") + (index << 2);
  const tapIP = long2ip(tapNetwork + 1);
  const appIP = long2ip(tapNetwork + 2);

  compose.setCommands(s, (function*() {
    yield* scriptCleanup();
    yield "";

    yield `HOSTIF=$(ip -j addr show to ${hostIP} | jq -r '.[0].ifname')`;
    yield "msg Found host netif $HOSTIF";

    yield `TABLE=$(ip -j rule list from ${hostIP} | jq -r '.[].table')`;
    yield "if [[ -n $TABLE ]]; then";
    yield `  msg Using route table $TABLE for traffic from ${appIP}`;
    yield `  ip rule add from ${appIP} table $TABLE`;
    yield "fi";
    yield "";

    if (ports.length === 0) { // client
      yield `msg Configuring client NAT from ${appIP} to ${hostIP}`;
      yield* iptablesInsertWithCleanup("nat", "POSTROUTING", `-o $HOSTIF -s ${appIP} -j SNAT --to-source ${hostIP}`);
    } else { // server
      yield `msg Configuring server NAT from ${hostIP} to ${appIP}`;
      for (const portDef of ports) {
        const [protocol, port] = portDef.split(":") as [string, string];
        yield* iptablesInsertWithCleanup("nat", "PREROUTING", `-i $HOSTIF -p ${protocol} --dport ${port} -j DNAT --to-destination ${appIP}:${port}`);
      }
    }
    yield "msg Listing iptables NAT rules";
    yield "iptables -t nat -L -n";
    yield "";

    yield `msg Starting ns-3 application on ${tapNetif}`;
    yield `${shlex.join([
      ...commandLine,
      `--RngSeed=${rngSeed}`,
      `--RngRun=${index}`,
      `--tap-if=${tapNetif}`,
      `--tap-ip=${tapIP}`,
      "--tap-mask=255.255.255.252",
      `--app-ip=${appIP}`,
    ])} 2>&1 &`;
    yield "wait $!";
  })());
}

export const ns3http: TrafficGen = {
  determineDirection() {
    return Direction.dl;
  },
  nPorts: 4,
  serverDockerImage: "5gdeploy.localhost/ns3http",
  serverPerDN: true,
  serverSetup(s, { port, dnIP, sFlags }) {
    setupNs3(s, port >> 2, dnIP, ["tcp:80"], ["ns3http", "--listen", ...sFlags]);
    s.environment.NS_LOG = "ThreeGppHttpServer";
  },
  clientDockerImage: "5gdeploy.localhost/ns3http",
  clientSetup(s, { port, dnIP, pduIP, cFlags }) {
    setupNs3(s, port >> 2, pduIP, [], ["ns3http", `--connect=${dnIP}`, ...cFlags]);
    s.environment.NS_LOG = "ThreeGppHttpClient";
  },
  statsExt: ".log",
};
