import type { AnyIterable } from "streaming-iterables";

import type { ComposeService } from "../types/compose.js";

export const mysql = {
  image: "bitnami/mariadb:10.6",
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
};

export const mongo = {
  image: "mongo:7",
  init(s: ComposeService): void {
    void s;
  },
};
