import path from "node:path";

import { phoenixDockerImage, updateService } from "../phoenix-compose/compose.js";
import { applyNetdef, IPMAP, ScenarioFolder } from "../phoenix-config/mod.js";
import type { NetDefComposeContext } from "./context.js";
import { env } from "./env.js";

export async function phoenixCore(ctx: NetDefComposeContext): Promise<void> {
  const b = new PhoenixCoreBuilder(ctx);
  b.build();
  await b.save("core");
}

export async function phoenixRAN(ctx: NetDefComposeContext): Promise<void> {
  const b = new PhoenixRANBuilder(ctx);
  b.build();
  await b.save("ran");
}

class PhoenixScenarioBuilder {
  constructor(protected readonly ctx: NetDefComposeContext) {
    this.ctx.defineNetwork("mgmt", true);
  }

  public readonly sf = new ScenarioFolder();

  protected tplFile(relPath: string): string {
    return path.resolve(env.D5G_PHOENIX_CFG, relPath);
  }

  protected createNetworkFunction<T>(tpl: string, nets: readonly string[], list?: readonly T[]): Map<string, T> {
    for (const net of nets) {
      this.ctx.defineNetwork(net);
    }
    nets = ["mgmt", ...nets];

    const tplCt = path.basename(tpl, ".json");
    const nf = IPMAP.toNf(tplCt);
    list ??= [{ name: nf } as any];
    const m = IPMAP.suggestNames(nf, list);

    for (const ct of m.keys()) {
      this.ctx.defineService(ct, phoenixDockerImage, nets);
      const ctFile = `${ct}.json`;
      this.sf.createFrom(ctFile, this.tplFile(tpl));
      this.sf.edit(ctFile, (body) => body.replaceAll(`%${tplCt.toUpperCase()}_`, `%${ct.toUpperCase()}_`));
      this.sf.editNetworkFunction(ct, (c) => {
        const command = c.getModule("command", true);
        if (command) {
          command.config.GreetingText = `${ct.toUpperCase()}>`;
        }

        const nrfClient = c.getModule("nrf_client", true);
        if (nrfClient) {
          nrfClient.config.nf_profile.nfInstanceId = globalThis.crypto.randomUUID();
        }
      });
    }
    return m;
  }

  protected createDatabase(tpl: string, db?: string): void {
    const tplName = path.basename(tpl, ".sql");
    db ??= tplName;
    const dbFile = `sql/${db}.sql`;
    this.sf.createFrom(dbFile, this.tplFile(tpl));
    if (db !== tplName) {
      this.sf.edit(dbFile, (body) => {
        body = body.replace(/^create database .*;$/im, `CREATE OR REPLACE DATABASE ${db};`);
        body = body.replace(/^use .*;$/im, `USE ${db};`);
        body = body.replaceAll(/^grant ([a-z,]*) on \w+\.\* to (.*);$/gim, `GRANT $1 ON ${db}.* TO $3;`);
        return body;
      });
    }
  }

  public async save(kind: "core" | "ran"): Promise<void> {
    this.sf.ipmap = IPMAP.fromCompose(this.ctx.c);
    this.sf.preScaled = true;
    applyNetdef(this.sf, this.ctx.netdef, kind);

    for (const service of Object.values(this.ctx.c.services)) {
      const isRAN = ["gnb", "ue"].includes(IPMAP.toNf(service.container_name));
      if (isRAN !== (kind === "ran")) {
        continue;
      }
      updateService(service);
      for (const volume of service.volumes) {
        switch (volume.source) {
          case "./cfg": {
            volume.source = `./${kind}-cfg`;
            break;
          }
          case "./sql": {
            volume.source = `./${kind}-sql`;
            break;
          }
        }
      }
    }

    await this.sf.save(path.resolve(this.ctx.out, `${kind}-cfg`), path.resolve(this.ctx.out, `${kind}-sql`));
  }
}

class PhoenixCoreBuilder extends PhoenixScenarioBuilder {
  public build(): void {
    this.buildSQL();
    this.buildNRF();
    this.buildUDM();
    this.buildAUSF();
    this.buildAMFs();
    this.buildSMFs();
    this.buildDataPath();
  }

  private buildSQL(): void {
    this.ctx.defineNetwork("db");
    this.ctx.defineService("sql", phoenixDockerImage, ["db"]);
  }

  private buildNRF(): void {
    this.createNetworkFunction("5g/nrf.json", ["cp"]);
  }

  private buildUDM(): void {
    this.createDatabase("5g/sql/udm_db.sql");
    this.createNetworkFunction("5g/udm.json", ["cp", "db"]);
  }

  private buildAUSF(): void {
    this.createNetworkFunction("5g/ausf.json", ["cp"]);
  }

  private buildAMFs(): void {
    this.createNetworkFunction("5g/amf.json", ["cp", "n2"], this.ctx.network.amfs);
  }

  private buildSMFs(): void {
    this.createDatabase("5g/sql/smf_db.sql");
    this.createNetworkFunction("5g/smf.json", ["cp", "db", "n4"], this.ctx.network.smfs);
  }

  private buildDataPath(): void {
    this.createNetworkFunction("5g/upf2.json", ["n3", "n4", "n6", "n9"], this.ctx.network.upfs);

    this.ctx.defineNetwork("hnet");
    this.ctx.defineService("igw", phoenixDockerImage, ["mgmt", "n6", "hnet"]);
    this.ctx.defineService("hostnat", phoenixDockerImage, ["mgmt", "hnet"]);
    this.sf.initCommands.get("igw").push(
      "ip link set n6 mtu 1456",
      "iptables -w -t nat -A POSTROUTING -o hnet -j MASQUERADE",
    );
  }
}

class PhoenixRANBuilder extends PhoenixScenarioBuilder {
  public build(): void {
    this.buildGNBs();
    this.buildUEs();
  }

  private buildGNBs(): void {
    this.createNetworkFunction("5g/gnb1.json", ["air", "n2", "n3"], this.ctx.network.gnbs);
  }

  private buildUEs(): void {
    this.sf.createFrom("ue-tunnel-mgmt.sh", this.tplFile("5g/ue-tunnel-mgmt.sh"));
    this.createNetworkFunction("5g/ue1.json", ["air"], this.ctx.network.subscribers);
  }
}
