import path from "node:path";

import * as fsWalk from "@nodelib/fs.walk/promises";

import { compose, http2Port, importGrafanaDashboard, netdef, type NetDefComposeContext, setProcessExporterRule } from "../netdef-compose/mod.js";
import type { ComposeService, PH } from "../types/mod.js";
import { assert, file_io } from "../util/mod.js";
import { NetworkFunction } from "./nf.js";
import { cfgdir, phoenixDockerImage, type PhoenixOpts } from "./options.js";

interface PhoenixServiceContext {
  s: ComposeService;
  nf: NetworkFunction;
  initCommands: string[];
  makeDatabase: (tpl: `${string}.sql`, database: PH.Database, append: Iterable<string>) => Promise<void>;
}

export abstract class PhoenixScenarioBuilder {
  protected abstract nfKind: string;
  protected readonly plmn: PH.PLMNID;
  private hasPrometheus = false;

  constructor(
      protected readonly ctx: NetDefComposeContext,
      protected readonly opts: PhoenixOpts,
  ) {
    this.ctx.defineNetwork("mgmt", { wantNAT: true });
    this.ctx.defineNetwork("air", { mtu: 1470 });
    this.ctx.defineNetwork("n6", { mtu: 1456 });

    this.plmn = netdef.splitPLMN(this.ctx.network.plmn);
    assert(this.plmn.mnc.length === 2, "Open5GCore only supports 2-digit MNC");
  }

  private readonly unsaved = new Map<string, PhoenixServiceContext>();

  private tplFile(relPath: string): string {
    return path.resolve(this.opts["phoenix-cfg"], relPath);
  }

  protected async defineService(ct: string, nets: readonly string[], tpl: `${string}.json`): Promise<PhoenixServiceContext> {
    const s = this.ctx.defineService(ct, phoenixDockerImage, ["mgmt", ...nets]);
    s.working_dir = cfgdir;
    s.stdin_open = true;
    s.tty = true;
    s.cap_add.push("NET_ADMIN");
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
    s.sysctls["net.ipv6.conf.all.disable_ipv6"] = 1;

    const initCommands: string[] = [];
    const sc: PhoenixServiceContext = {
      s,
      nf: await this.loadNF(tpl, s),
      initCommands,
      makeDatabase: async (tpl, d, append) => {
        d.database = ct;
        d.hostname = compose.getIP(this.ctx.c, "sql", "db");
        await this.ctx.writeFile(
          `${this.nfKind}-sql/${ct}.sql`,
          compose.mysql.join(await this.loadDatabase(tpl, ct), append),
        );
        initCommands.push(...compose.mysql.wait(d.hostname, d.username, d.password, ct));
      },
    };
    this.unsaved.set(ct, sc);
    return sc;
  }

  private async loadNF(tpl: string, s: ComposeService): Promise<NetworkFunction> {
    const tplCt = path.basename(tpl, ".json");
    let body = await file_io.readText(this.tplFile(tpl), { once: true });
    body = body.replaceAll(/"%([A-Z\d]+)_([A-Z\d]+)_IP"/g, (m, ct: string, net: string) => {
      void m;
      ct = ct.toLowerCase();
      net = net.toLowerCase();
      let ip = "unresolved-ip-address";
      try {
        ip = ct === tplCt ? compose.getIP(s, net) : compose.getIP(this.ctx.c, ct, net);
      } catch {}
      return JSON.stringify(ip);
    });

    const nf = NetworkFunction.parse(body);
    nf.Phoenix.Platform.Debug.level = this.opts["phoenix-debug"];

    for (const binaryName of ["httpd", "json_rpc", "remote_command", "rest_api"] as const) {
      nf.editModule(binaryName, true, (m) => {
        delete m.ignore;
      });
    }

    nf.editModule("command", true, ({ config }) => {
      config.DisablePrompt = false;
      config.GreetingText = `${s.container_name.toUpperCase()}>`;
    });

    nf.editModule("http2", true, ({ config }) => {
      assert(config.Acceptor.length === 1);
      config.Acceptor[0]!.port = http2Port;
    });

    nf.editModule("nrf_client", true, ({ config }) => {
      config.nf_profile.plmnList = [this.plmn];
      config.nf_profile.nfInstanceId = globalThis.crypto.randomUUID();
      config.nf_instance.port = http2Port;
      config.nrf_server.port = http2Port;
    });

    nf.editModule("monitoring", true, ({ config }) => {
      this.hasPrometheus = true;
      const mgmt = compose.getIP(s, "mgmt");
      config.Prometheus = {
        listener: mgmt,
        port: 9888,
        enabled: 1,
      };

      const target = new URL("http://localhost:9888/metrics");
      target.hostname = mgmt;
      target.searchParams.set("job_name", "phoenix");
      target.searchParams.append("labels", `phnf=${s.container_name}`);
      compose.annotate(s, "prometheus_target", target.toString());
    });

    return nf;
  }

  private async loadDatabase(tpl: string, dbName: string): Promise<string> {
    let body = await file_io.readText(this.tplFile(tpl), { once: true });
    body = body.replace(/^create database [^;]+;$/im, `CREATE OR REPLACE DATABASE ${dbName};`);
    body = body.replaceAll(/^create database [^;]+;$/gim, "");
    body = body.replaceAll(/^use [^;]+;$/gim, `USE ${dbName};`);
    body = body.replaceAll(/^grant ([\w,]+) on \w+\.\* to ([^;]+);$/gim, (match, privileges: string, userSpec: string) => {
      void match;
      return `GRANT ${privileges.toUpperCase()} ON ${dbName}.* TO ${
        userSpec.replace(/ identified by /i, " IDENTIFIED BY ")};`;
    });
    return body;
  }

  protected async finish(): Promise<void> {
    for (const [ct, { s, nf, initCommands }] of this.unsaved) {
      await this.ctx.writeFile(`${this.nfKind}-cfg/${ct}.json`, nf, {
        s, target: path.join(cfgdir, `${ct}.json`),
      });
      compose.setCommands(s, [
        ...compose.renameNetifs(s, { disableTxOffload: true }),
        ...initCommands,
        `exec /opt/phoenix/dist/phoenix.sh -j ${ct}.json -p /opt/phoenix/dist/lib`,
      ]);
    }
    this.unsaved.clear();

    if (this.hasPrometheus) {
      await this.updatePrometheus();
    }
  }

  private async updatePrometheus(): Promise<void> {
    setProcessExporterRule(this.ctx, "phoenix",
      [{
        comm: ["phoenix"],
        cmdline: [/-j (?:[\w/]+\/)?(?<NF>\w+)\.json/],
        name: "phoenix:{{.Matches.NF}}",
      }],
      [{
        source_labels: ["groupname"],
        regex: /phoenix:(\w+)/,
        target_label: "phnf",
      }],
    );

    for (const entry of await fsWalk.walk(this.tplFile("5g/prometheus"), {
      entryFilter: (entry) => entry.name.endsWith(".json"),
    })) {
      await importGrafanaDashboard(this.ctx, entry.path);
    }
  }
}
