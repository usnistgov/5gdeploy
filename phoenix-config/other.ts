import DefaultMap from "mnemonist/default-map.js";
import MultiMap from "mnemonist/multi-map.js";
import { Netmask } from "netmask";

/** Content of ph_init other file. */
export class OtherTable {
  /** Parse other file. */
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

        m = /^ip\s+route\s+add\s+([\d./]+)(?:\s+via\s+([\d.]+))?(?:\s+dev\s+(\w+))?$/.exec(cmd);
        if (m) {
          this.routes.set(ct, {
            dest: new Netmask(m[1]!),
            via: m[2] && new Netmask(m[2]!).base,
            dev: m[3],
          });
        } else {
          this.commands.get(ct).push(cmd);
        }
        break;
      }
    }
  }

  public readonly commands = new DefaultMap<string, string[]>(() => []);
  public readonly routes = new MultiMap<string, OtherTable.Route>();

  /** Save other file. */
  public save(): string {
    const lines: string[] = [];
    for (const [ct, cmds] of this.commands) {
      for (const cmd of cmds) {
        lines.push(`c ${ct} ${cmd}\n`);
      }
    }
    for (const [ct, { dest, via, dev }] of this.routes) {
      lines.push(`c ${ct} ip route add ${dest}${via ? ` via ${via}` : ""}${dev ? ` dev ${dev}` : ""}\n`);
    }
    return lines.join("");
  }
}
export namespace OtherTable {
  export interface Route {
    dest: Netmask;
    via?: string;
    dev?: string;
  }
}
