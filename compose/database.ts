import type { AnyIterable } from "streaming-iterables";

import type { ComposeService } from "../types/mod.js";

/** MySQL database container helpers. */
export const mysql = {
  /** Docker image name and tag. */
  image: "bitnami/mariadb:10.6",

  /** Initialize Compose service. */
  init(s: ComposeService, startdb?: string): void {
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
  },

  /** Join SQL statements into string. */
  async join(...parts: ReadonlyArray<string | AnyIterable<string>>): Promise<string> {
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

      for await (const stmt of p) {
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
  image: "mongo:7",

  init(s: ComposeService): void {
    void s;
  },
};
