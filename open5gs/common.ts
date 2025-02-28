import type { PartialDeep } from "type-fest";

import { compose } from "../netdef-compose/mod.js";
import type { ComposeService, O5G } from "../types/mod.js";
import type { O5GOpts } from "./options.js";

export const o5DockerImage = "5gdeploy.localhost/open5gs";
export const webuiDockerImage = "gradiant/open5gs-webui:2.7.2";

export function makeSockNode(s: ComposeService, net: string, port?: number): O5G.SockNode {
  return {
    family: 2,
    address: compose.getIP(s, net),
    port,
  };
}

export function makeMetrics(s: ComposeService): O5G.Metrics {
  const target = new URL("http://localhost:9091/metrics");
  target.hostname = compose.getIP(s, "mgmt");
  target.searchParams.set("job_name", "open5gs");
  target.searchParams.append("labels", `nf=${s.container_name}`);
  compose.annotate(s, "prometheus_target", target.toString());

  return {
    server: [{ dev: "mgmt", port: 9091 }],
  };
}

export function* makeLaunchCommands<C extends PartialDeep<O5G.RootBase>>(
    name: string, cfg: C,
    {
      "o5g-loglevel": level,
      dels = [],
    }: O5GOpts & Pick<compose.mergeConfigFile.Options, "dels">,
): Iterable<string> {
  cfg.logger = { level };

  const nf = compose.nameToNf(name);
  yield `msg Preparing Open5GS ${nf.toUpperCase()} config`;
  yield* compose.mergeConfigFile(cfg, {
    base: `/opt/open5gs/etc/open5gs/${nf}.yaml`,
    merged: `/${name}.yaml`,
    dels: [".db_uri", ...dels],
  });

  yield `msg Starting Open5GS ${nf.toUpperCase()} service`;
  yield `exec yasu open5gs open5gs-${nf}d -c /${name}.yaml`;
}
