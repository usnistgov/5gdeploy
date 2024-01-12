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
};

export const mongo = {
  image: "mongo:7",
  init(s: ComposeService): void {
    void s;
  },
};
