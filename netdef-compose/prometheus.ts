import * as compose from "../compose/mod.js";
import type { prom } from "../types/mod.js";
import type { YargsInfer, YargsOptions } from "../util/mod.js";
import type { NetDefComposeContext } from "./context.js";

/** Yargs options definition for Prometheus. */
export const prometheusOptions = {
  prometheus: {
    default: true,
    defaultDescription: "enabled if Prometheus targets exist",
    desc: "add Prometheus and Grafana containers",
    type: "boolean",
  },
} as const satisfies YargsOptions;

export async function definePrometheus(ctx: NetDefComposeContext, opts: YargsInfer<typeof prometheusOptions>): Promise<void> {
  if (!opts.prometheus) {
    return;
  }

  const services = compose.listByAnnotation(ctx.c, "prometheus_target", () => true);
  if (services.length === 0) {
    // no Prometheus target
    return;
  }

  const scrapeJobs = new Map<string, prom.ScrapeConfig>();
  const nets = new Set<string>();
  for (const s of services) {
    const target = new URL(compose.annotate(s, "prometheus_target")!);
    const jobName = target.searchParams.get("job_name") ?? s.container_name;
    const job = scrapeJobs.get(jobName) ?? {
      job_name: jobName,
      metrics_path: target.pathname,
      static_configs: [],
    };
    scrapeJobs.set(jobName, job);

    const labels: Record<string, string> = {};
    for (const kv of target.searchParams.getAll("labels")) {
      const [k = "", v = ""] = kv.split("=");
      labels[k] = v;
    }
    job.static_configs.push({
      targets: [target.host],
      labels,
    });

    const net = ctx.ipAlloc.findNetwork(target.hostname);
    if (net) {
      nets.add(net);
    }
  }
  nets.add("mgmt");

  const promService = ctx.defineService("prometheus", "prom/prometheus", [...nets]);
  promService.command = [
    "--config.file=/etc/prometheus/prometheus.yml",
  ];
  const promUrl = new URL("http://localhost:9090");
  promUrl.hostname = promService.networks.mgmt!.ipv4_address;

  const promCfg: prom.Config = {
    scrape_configs: [...scrapeJobs.values()],
  };
  await ctx.writeFile("prometheus.yml", promCfg, {
    s: promService,
    target: "/etc/prometheus/prometheus.yml",
  });

  const graService = ctx.defineService("grafana", "grafana/grafana", ["mgmt"]);
  graService.environment.GF_SECURITY_ADMIN_USER = "admin";
  graService.environment.GF_SECURITY_ADMIN_PASSWORD = "grafana";

  const graCfg = {
    apiVersion: 1,
    datasources: [{
      name: "Prometheus",
      type: "prometheus",
      url: promUrl.toString(),
      isDefault: true,
      access: "proxy",
      editable: true,
    }],
  };
  await ctx.writeFile("grafana-datasource.yml", graCfg, {
    s: graService,
    target: "/etc/grafana/provisioning/datasources/datasource.yml",
  });
}
