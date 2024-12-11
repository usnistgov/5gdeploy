import * as compose from "../compose/mod.js";
import type { ComposeService, O5G } from "../types/mod.js";

export const o5DockerImage = "5gdeploy.localhost/open5gs";

export function configureMetrics(s: ComposeService): O5G.Metrics {
  const target = new URL("http://localhost:9091/metrics");
  target.hostname = compose.getIP(s, "mgmt");
  target.searchParams.set("job_name", "open5gs");
  target.searchParams.append("labels", `nf=${s.container_name}`);
  compose.annotate(s, "prometheus_target", target.toString());

  return {
    server: [{ dev: "mgmt", port: 9091 }],
  };
}

export function* makeLaunchCommands(
    name: string, cfg: unknown,
    { dels }: Pick<compose.mergeConfigFile.Options, "dels"> = {},
): Iterable<string> {
  const nf = compose.nameToNf(name);
  yield `msg Preparing Open5GS ${nf.toUpperCase()} config`;
  yield* compose.mergeConfigFile(cfg, {
    base: `/opt/open5gs/etc/open5gs/${nf}.yaml`,
    merged: `/${name}.yaml`,
    dels,
  });
  yield `msg Starting Open5GS ${nf.toUpperCase()} service`;
  yield `exec yasu open5gs open5gs-${nf}d -c /${name}.yaml`;
}
