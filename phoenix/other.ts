import DefaultMap from "mnemonist/default-map.js";
import MultiMap from "mnemonist/multi-map.js";
import type { Netmask } from "netmask";
import map from "obliterator/map.js";

/** Content of ph_init `other` file. */
export class OtherTable {
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

const routeKeys = ["table", "metric", "via", "dev"] as const satisfies ReadonlyArray<keyof OtherTable.Route>;

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
