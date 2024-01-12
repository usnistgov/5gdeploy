import * as fs from "node:fs/promises";
import path from "node:path";

import { mysql } from "../compose/database";
import * as compose from "../compose/mod.js";
import type { NetDefComposeContext } from "../netdef-compose/context";
import type * as CN5G from "../types/oai-cn5g.js";
import * as oai_conf from "./conf.js";

class CN5GBuilder {
  constructor(protected readonly ctx: NetDefComposeContext, protected readonly c: CN5G.Config) {}

  public async buildCP(): Promise<void> {
    await this.buildSQL();
    for (const [nf, c] of Object.entries(this.c.nfs)) {
      const nets = Object.keys(c).filter((net) => net.startsWith("n"));
      for (const [i, net] of nets.entries()) {
        c[net as `n${number}`]!.interface_name = `eth${2 + i}`;
      }
      nets.unshift("cp", "db");
      c.sbi.interface_name = "eth0";

      const s = this.ctx.defineService(nf, `oaisoftwarealliance/oai-${nf}`, nets);
      s.cap_add.push("NET_ADMIN");
      s.volumes.push({
        type: "bind",
        source: "./cp-cfg/config.yaml",
        target: `/openair-${nf}/etc/config.yaml`,
      });

      c.host = s.networks.cp!.ipv4_address;

      compose.setCommands(s, [
        "msg ip addr listing:",
        "/usr/sbin/ifconfig",
        `msg Starting ${nf}`,
        `./bin/oai_${nf} -c ./etc/config.yaml -o`,
      ]);
    }
    await this.ctx.writeFile("cp-cfg/config.yaml", this.c);
  }

  private async buildSQL(): Promise<void> {
    await this.ctx.writeFile("cp-sql/oai_db.sql", await fs.readFile(path.resolve(oai_conf.cn5gPath, "database/oai_db2.sql")));

    const s = this.ctx.defineService("sql", mysql.image, ["db"]);
    mysql.init(s, "cp-sql");
    s.environment.MYSQL_DATABASE = "oai_db";
    s.environment.MYSQL_USER = "oai";
    s.environment.MYSQL_PASSWORD = "oai";

    this.c.database.host = s.networks.db!.ipv4_address;
    this.c.database.user = "oai";
    this.c.database.password = "oai";
    this.c.database.database_name = "oai_db";
  }
}

export async function oaiCP(ctx: NetDefComposeContext): Promise<void> {
  const b = new CN5GBuilder(ctx, await oai_conf.loadCN5G());
  await b.buildCP();
}
