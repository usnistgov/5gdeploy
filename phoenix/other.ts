import DefaultMap from "mnemonist/default-map.js";
import MultiMap from "mnemonist/multi-map.js";
import { Netmask } from "netmask";
import map from "obliterator/map.js";

/** Content of ph_init `other` file. */
export class OtherTable {
  /** Parse `other` file. */
  public static parse(body: string): OtherTable {
    const other = new OtherTable();
    for (const line of body.split("\n")) {
      other.parseLine(line);
    }
    return other;
  }

  private parseLine(line: string): void {
    line = line.replace(/#.*/, "").trim();
    switch (line.at(0)) {
      case "r": {
        const [, ct, dest, via] = line.split(/\s+/);
        if (!ct || !dest || !via) {
          throw new Error("invalid 'r' line");
        }
        this.routes.set(ct, {
          dest: dest === "default" ? new Netmask("0.0.0.0/0") : new Netmask(dest),
          via: new Netmask(via).base,
        });
        break;
      }
      case "c": {
        let m = /^c\s+(\w+)\s+(\w.*)$/.exec(line);
        if (!m) {
          throw new Error("invalid 'c' line");
        }
        const ct = m[1]!;
        const cmd = m[2]!;

        m = /^ip\s+route\s+add\s+([\d./]+)(?:\s+via\s+([\d.]+|\$[A-Z\d_]+))?(?:\s+dev\s+(\w+))?$/.exec(cmd);
        if (m) {
          this.routes.set(ct, {
            dest: new Netmask(m[1]!),
            via: m[2] && (m[2].startsWith("$") ? m[2] : new Netmask(m[2]).base),
            dev: m[3],
          });
        } else {
          this.commands.get(ct).push(cmd);
        }
        break;
      }
    }
  }

  /** Per-container initialization commands. */
  public readonly commands = new DefaultMap<string, string[]>(() => []);

  /** Per-container IPv4 routes. */
  public readonly routes = new MultiMap<string, OtherTable.Route>();

  /** List commands in specific container. */
  public listCommands(ct: string): string[] {
    return [...(this.commands.peek(ct) ?? []), ...map(this.routes.get(ct) ?? [], (route) => routeToCommand(route))];
  }

  /** Save `other` file. */
  public save(): string {
    const lines: string[] = [];
    for (const [ct, cmds] of this.commands) {
      for (const cmd of cmds) {
        lines.push(`c ${ct} ${cmd}\n`);
      }
    }
    for (const [ct, route] of this.routes) {
      lines.push(`c ${ct} ${routeToCommand(route)}\n`);
    }
    return lines.join("");
  }
}
export namespace OtherTable {
  export interface Route {
    dest: "default" | Netmask;
    table?: number;
    metric?: number;
    via?: string;
    dev?: string;
  }
}

const routeKeys: ReadonlyArray<keyof OtherTable.Route> = ["table", "metric", "via", "dev"];

function routeToCommand(route: OtherTable.Route): string {
  const routeSpec = routeKeys.map((k) => {
    const v = route[k];
    if (v === undefined) {
      return "";
    }
    return ` ${k} ${v}`;
  });
  return `ip route add ${route.dest}${routeSpec.join("")}`;
}
