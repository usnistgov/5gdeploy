import path from "node:path";

import DefaultWeakMap from "mnemonist/default-weak-map.js";
import map from "obliterator/map.js";
import type { OverrideProperties } from "type-fest";

import * as compose from "../compose/mod.js";
import type { ComposeService, process_exporter, prom } from "../types/mod.js";
import { file_io, YargsDefaults, type YargsInfer, type YargsOptions } from "../util/mod.js";
import type { NetDefComposeContext } from "./context.js";

/** Yargs options definition for Prometheus. */
export const prometheusOptions = {
  prometheus: {
    default: true,
    desc: "add Prometheus and Grafana containers",
    group: "measurements",
    type: "boolean",
  },
  "prometheus-scrape-interval": {
    default: 15,
    desc: "Prometheus scrape interval (seconds)",
    group: "measurements",
    type: "number",
  },
} as const satisfies YargsOptions;

class PromBuilder {
  constructor(
      private readonly ctx: NetDefComposeContext,
  ) {}

  private opts = YargsDefaults(prometheusOptions);
  private readonly scrapeJobs = new Map<string, prom.ScrapeConfig>();

  public async build(opts: YargsInfer<typeof prometheusOptions>): Promise<void> {
    this.opts = opts;
    if (!this.opts.prometheus) {
      return;
    }

    this.ctx.defineNetwork("meas", { wantNAT: true });
    await this.buildProcessExporter();
    const services = compose.listByAnnotation(this.ctx.c, "prometheus_target", () => true);
    const promUrl = this.buildPrometheus(services);
    await this.buildGrafana(promUrl);
  }

  public async finish(): Promise<void> {
    if (!this.opts.prometheus) {
      return;
    }
    this.configureProcessExporter();
    await this.configurePrometheus();
  }

  public readonly processExporterRules = new Map<string, [
    names: process_exporter.ProcessName[],
    relabel: prom.RelabelConfig[],
  ]>();

  private async buildProcessExporter(): Promise<void> {
    const s = this.ctx.defineService("processexporter", "ncabatoff/process-exporter", ["meas"]);
    compose.annotate(s, "every_host", 1);
    compose.exposePort(s, 9256);
    s.volumes.push({
      type: "bind",
      source: "/proc",
      target: "/host/proc",
    });
    s.command = [
      "--procfs=/host/proc",
      "-config.path=/config.yml",
    ];
    s.privileged = true;

    const cfg: process_exporter.Config = {
      process_names: Array.from(this.processExporterRules.values(), ([names]) => names).flat(1),
    };
    await this.ctx.writeFile("process-exporter.yml", cfg, {
      s,
      target: "/config.yml",
    });
  }

  private configureProcessExporter(): void {
    const s = this.ctx.c.services.processexporter!;
    const ctTarget = `${s.networks.meas!.ipv4_address}:9256`;
    const targets = new Set(map(
      compose.classifyByHost(this.ctx.c),
      ({ host }) => host === "" ? ctTarget : `${new URL(`ssh://${host}`).hostname}:9256`,
    ));
    if (targets.size === 0) {
      targets.add(ctTarget);
    }

    this.scrapeJobs.set("processexporter", {
      job_name: "process-exporter",
      static_configs: [{
        targets: Array.from(targets),
      }],
      metric_relabel_configs: Array.from( // not relabel_configs, see https://stackoverflow.com/a/70359287
        this.processExporterRules.values(),
        ([, relabel]) => relabel,
      ).flat(1),
    });
  }

  private buildPrometheus(services: readonly ComposeService[]): URL {
    const nets = new Set<string>(["meas"]);
    for (const s of services) {
      const target = new URL(compose.annotate(s, "prometheus_target")!);
      const jobName = target.searchParams.get("job_name") ?? s.container_name;
      const job = this.scrapeJobs.get(jobName) ?? {
        job_name: jobName,
        metrics_path: target.pathname,
        static_configs: [],
      };
      this.scrapeJobs.set(jobName, job);

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

    const s = this.ctx.defineService("prometheus", "prom/prometheus", [...nets]);
    s.command = [
      "--config.file=/etc/prometheus/prometheus.yml",
    ];

    const url = new URL("http://localhost:9090");
    url.hostname = s.networks.meas!.ipv4_address;
    return url;
  }

  private async configurePrometheus(): Promise<void> {
    const s = this.ctx.c.services.prometheus!;

    const cfg: prom.Config = {
      global: {
        scrape_interval: "15s",
        evaluation_interval: "60s",
      },
      scrape_configs: [...this.scrapeJobs.values()],
    };
    await this.ctx.writeFile("prometheus.yml", cfg, {
      s,
      target: "/etc/prometheus/prometheus.yml",
    });
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

const ctxBuilder = new DefaultWeakMap<NetDefComposeContext, PromBuilder>((ctx) => new PromBuilder(ctx));

/** Define Prometheus and Grafana containers in the scenario. */
export async function prometheus(ctx: NetDefComposeContext, opts: YargsInfer<typeof prometheusOptions>): Promise<void> {
  const b = ctxBuilder.get(ctx);
  await b.build(opts);
}

/** Finish configuring Prometheus. */
export async function prometheusFinish(ctx: NetDefComposeContext): Promise<void> {
  const b = ctxBuilder.get(ctx);
  await b.finish();
}

function regexToString(re: RegExp): string {
  // process-exporter is compiled with go@1.17.3 that does not support "(?<" syntax for named capture group.
  return re.source.replaceAll("(?<", "(?P<");
}

/** Set process-exporter process_names and relabel_config rules. */
export function setProcessExporterRule(
    ctx: NetDefComposeContext,
    key: string,
    names: readonly setProcessExporterRule.ProcessName[],
    relabel: readonly setProcessExporterRule.RelabelConfig[],
) {
  const b = ctxBuilder.get(ctx);
  b.processExporterRules.set(key, [
    names.map((rule) => ({
      ...rule,
      cmdline: rule.cmdline.map((re) => regexToString(re)),
    })),
    relabel.map((rule) => ({
      ...rule,
      regex: rule.regex && regexToString(rule.regex),
    })),
  ]);
}
export namespace setProcessExporterRule {
  export type ProcessName = OverrideProperties<process_exporter.ProcessName, {
    cmdline: readonly RegExp[];
  }>;

  export type RelabelConfig = OverrideProperties<prom.RelabelConfig, {
    regex?: RegExp;
  }>;
}

/**
 * Import a Grafana dashboard definition file.
 * @param filename - Dashboard definition filename.
 */
export async function importGrafanaDashboard(ctx: NetDefComposeContext, filename: string): Promise<void> {
  let def = await file_io.readText(filename);
  def = def.replaceAll("${DS_PROMETHEUS}", "Prometheus"); // eslint-disable-line no-template-curly-in-string
  await ctx.writeFile(path.join("grafana-dashboards", path.basename(filename)), def);
}
