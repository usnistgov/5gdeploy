import path from "node:path";

import * as compose from "../compose/mod.js";
import type { ComposeService, prom } from "../types/mod.js";
import { file_io, type YargsInfer, type YargsOptions } from "../util/mod.js";
import type { NetDefComposeContext } from "./context.js";

/** Yargs options definition for Prometheus. */
export const prometheusOptions = {
  prometheus: {
    default: true,
    defaultDescription: "enabled if Prometheus targets exist",
    desc: "add Prometheus and Grafana containers",
    group: "measurements",
    type: "boolean",
  },
} as const satisfies YargsOptions;

class PromBuilder {
  constructor(
      private readonly ctx: NetDefComposeContext,
      private readonly opts: YargsInfer<typeof prometheusOptions>,
  ) {}

  public async build(): Promise<void> {
    if (!this.opts.prometheus) {
      return;
    }

    const services = compose.listByAnnotation(this.ctx.c, "prometheus_target", () => true);
    if (services.length === 0) {
      // no Prometheus target
      return;
    }

    const promUrl = await this.buildPrometheus(services);
    await this.buildGrafana(promUrl);
  }

  private async buildPrometheus(services: readonly ComposeService[]): Promise<URL> {
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

      const net = this.ctx.ipAlloc.findNetwork(target.hostname);
      if (net) {
        nets.add(net);
      }
    }
    nets.add("meas");

    const s = this.ctx.defineService("prometheus", "prom/prometheus", [...nets]);
    s.command = [
      "--config.file=/etc/prometheus/prometheus.yml",
    ];

    const cfg: prom.Config = {
      scrape_configs: [...scrapeJobs.values()],
    };
    await this.ctx.writeFile("prometheus.yml", cfg, {
      s,
      target: "/etc/prometheus/prometheus.yml",
    });

    const url = new URL("http://localhost:9090");
    url.hostname = s.networks.meas!.ipv4_address;
    return url;
  }

  private async buildGrafana(promUrl: URL): Promise<void> {
    const s = this.ctx.defineService("grafana", "grafana/grafana-oss", ["meas"]);
    s.environment.GF_SECURITY_ADMIN_USER = "admin";
    s.environment.GF_SECURITY_ADMIN_PASSWORD = "grafana";
    s.environment.GF_FEATURE_TOGGLES_ENABLE = "autoMigrateOldPanels";

    await this.ctx.writeFile("grafana-dashboards", file_io.write.MKDIR, {
      s,
      target: "/var/lib/grafana/dashboards",
    });

    await this.ctx.writeFile("grafana-provisioning", file_io.write.MKDIR, {
      s,
      target: "/etc/grafana/provisioning",
    });
    await this.ctx.writeFile("grafana-provisioning/datasources/prometheus.yml", {
      apiVersion: 1,
      datasources: [{
        name: "Prometheus",
        type: "prometheus",
        url: promUrl.toString(),
        isDefault: true,
        access: "proxy",
        editable: true,
      }],
    });
    await this.ctx.writeFile("grafana-provisioning/dashboards/default.yml", {
      apiVersion: 1,
      providers: [{
        name: "Default",
        type: "file",
        options: {
          path: "/var/lib/grafana/dashboards",
        },
      }],
    });
  }
}

/** Define Prometheus and Grafana containers in the scenario. */
export async function prometheus(ctx: NetDefComposeContext, opts: YargsInfer<typeof prometheusOptions>): Promise<void> {
  const b = new PromBuilder(ctx, opts);
  await b.build();
}

/**
 * Import a Grafana dashboard definition file.
 * @param file - Dashboard definition filename.
 */
export async function importGrafanaDashboard(ctx: NetDefComposeContext, file: string): Promise<void> {
  let def = await file_io.readText(file);
  def = def.replaceAll("${DS_PROMETHEUS}", "Prometheus"); // eslint-disable-line no-template-curly-in-string
  return ctx.writeFile(path.join("grafana-dashboards", path.basename(file)), def);
}
