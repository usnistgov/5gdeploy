
import { compose, type netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, EUPF } from "../types/mod.js";

const eupfDockerImage = "5gdeploy.localhost/eupf";

/** Build eUPF. */
export async function eUPF(ctx: NetDefComposeContext, upf: netdef.UPF): Promise<void> {
  const s = ctx.defineService(upf.name, eupfDockerImage, upf.nets);
  compose.annotate(s, "cpus", 1);
  s.environment.GIN_MODE = "release";
  s.privileged = true;
  s.sysctls["net.ipv4.conf.all.forwarding"] = 1;

  ctx.finalize.push(async () => {
    const c = makeConfig(upf, s);
    await ctx.writeFile(`up-cfg/${upf.name}.yaml`, c, {
      s, target: "/config.yml",
    });
    compose.setCommands(s, makeCommands(ctx, upf, s), { shell: "ash" });
  });
}

function makeConfig({ nets }: netdef.UPF, s: ComposeService): EUPF.Config {
  const c: EUPF.Config = {
    interface_name: [],
    n3_address: "127.0.0.1",
    n9_address: "127.0.0.1",
    heartbeat_interval: 60,
    logging_level: "trace",
    feature_ftup: true,
  };

  c.pfcp_node_id = compose.getIP(s, "n4");
  c.pfcp_address = `${c.pfcp_node_id}:8805`;
  if (nets.includes("n6")) {
    c.interface_name.push("n6");
  }
  if (nets.includes("n3")) {
    c.interface_name.push("n3");
    c.n3_address = compose.getIP(s, "n3");
  }
  if (nets.includes("n9")) {
    c.interface_name.push("n9");
    c.n9_address = compose.getIP(s, "n9");
  }

  return c;
}

function* makeCommands(
    { c }: NetDefComposeContext,
    { peers }: netdef.UPF,
    s: ComposeService,
): Iterable<string> {
  yield* compose.waitNetifs(s, { disableTxOffload: true });

  yield "msg Inserting ARP/NDP entries";
  for (const { dnn } of peers.N6IPv4) {
    const [ip, mac] = compose.getIPMAC(c, `dn_${dnn}`, "n6");
    yield `ip neigh replace ${ip} lladdr ${mac} nud permanent dev n6`;
  }
  for (const gnb of peers.N3) {
    const [ip, mac] = compose.getIPMAC(c, gnb.name, "n3");
    yield `ip neigh replace ${ip} lladdr ${mac} nud permanent dev n3`;
  }
  for (const upf of peers.N9) {
    const [ip, mac] = compose.getIPMAC(c, upf.name, "n9");
    yield `ip neigh replace ${ip} lladdr ${mac} nud permanent dev n9`;
  }

  yield "msg Starting eUPF";
  yield "exec ash /app/bin/entrypoint.sh";
}
