import type { ComposeService } from "../types/mod.js";
import { assert } from "../util/mod.js";
import { getIP } from "./compose.js";
import type { ComposeContext } from "./context.js";

/** MySQL database container helpers. */
export const mysql = {
  /**
   * Define Compose service.
   * @param startdb - Host directory containing SQL scripts.
   */
  define(ctx: ComposeContext, startdb?: string): ComposeService {
    const s = ctx.defineService("sql", "bitnami/mariadb:10.6", ["db"]);
    if (startdb) {
      s.volumes.push({
        type: "bind",
        source: startdb,
        target: "/docker-entrypoint-startdb.d",
        read_only: true,
      });
    }
    s.environment.ALLOW_EMPTY_PASSWORD = "yes";
    s.environment.MARIADB_EXTRA_FLAGS = "--max_connections=1000";
    return s;
  },

  /** Join SQL statements into string. */
  join(...parts: ReadonlyArray<string | Iterable<string>>): string {
    let b = "";
    const append = (stmt: string): void => {
      if (/;\s*$/.test(stmt)) {
        b += `${stmt}\n`;
      } else {
        b += `${stmt};\n`;
      }
    };

    for (const p of parts) {
      if (typeof p === "string") {
        append(p);
        continue;
      }

      for (const stmt of p) {
        append(stmt.trim().replaceAll(/\n\s+/g, " "));
      }
    }

    return b;
  },

  /**
   * Generate commands to wait for the database to become available.
   *
   * @remarks
   * This requires mariadb-client-core-10.6 to be installed in the container.
   */
  *wait(hostname: string, username: string, password: string, database: string): Iterable<string> {
    yield `msg Waiting for ${database} database`;
    yield `while ! mysql -eQUIT -h${hostname} -u${username} -p${password} -D${database}; do`;
    yield "  sleep 1";
    yield "done";
    yield "sleep 1";
  },
};

/** Mongo database container helpers. */
export const mongo = {
  /**
   * Build mongodb: URL.
   * @param db - Database name.
   */
  makeUrl(db?: string): URL {
    const u = new URL("mongodb://invalid");
    if (db) {
      u.pathname = db;
    }
    return u;
  },

  /**
   * Define Compose service.
   * @param mongoUrl - mongodb: URL with optional database name in path, will be updated with IP+port.
   */
  define(ctx: ComposeContext, mongoUrl?: URL): ComposeService {
    const s = ctx.defineService("mongo", "mongo:7", ["db"]);
    if (mongoUrl) {
      assert(mongoUrl.protocol === "mongodb:");
      if (mongoUrl.pathname.length > 1) {
        s.environment.MONGO_INITDB_DATABASE = mongoUrl.pathname.slice(1); // strip leading "/"
      }
      mongoUrl.hostname = getIP(s, "db");
      mongoUrl.port = "27017";
    }
    return s;
  },
};
