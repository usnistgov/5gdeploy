import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import Dockerode from "dockerode";
import assert from "minimalistic-assert";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { IPMAP, NetworkFunction } from "../phoenix/mod.js";
import { type PhoenixClient, PhoenixClientJSONRPC, PhoenixClientUDP } from "./client.js";

let clientJ: PhoenixClientJSONRPC;
let clientU: PhoenixClientUDP;

function print<T>(value: T): T {
  const { color } = (value as PhoenixClient.ExecuteCommandResult);
  if (typeof color === "string") {
    process.stdout.write(`${color}\n`);
    return value;
  }

  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  }
  return value;
}

async function waitUntil<T>(
    retrieve: () => Promise<T>,
    predicate: (status: T) => boolean,
    change: () => Promise<void>,
    interval = 500,
    timeout = 30000,
): Promise<void> {
  let status = print(await retrieve());
  if (predicate(status)) {
    return;
  }
  await change();
  let limit = Math.ceil(timeout / interval);
  while (true) {
    await delay(interval);
    status = await retrieve();
    if (predicate(status)) {
      print(status);
      return;
    }
    if (--limit < 0) {
      print(status);
      throw new Error("condition not fulfilled within timeout");
    }
  }
}

function ue5gStatus(): Promise<any> {
  return clientJ.request("ue5g.status", []);
}

await yargs(hideBin(process.argv))
  .strict()
  .showHelpOnFail(false)
  .scriptName("phoenix-rpc")
  .option("host", {
    demandOption: true,
    desc: "network function IP address or JSON filename",
    type: "string",
  })
  .option("jsonrpc-port", {
    default: 10010,
    desc: "JSON-RPC port number",
    type: "number",
  })
  .option("udp-port", {
    default: 10000,
    desc: "UDP port number",
    type: "number",
  })
  .middleware(async ({ host, jsonrpcPort, udpPort }) => {
    const addrs: Record<"j" | "u", [string, number]> = { j: [host, jsonrpcPort], u: [host, udpPort] };
    if (host.endsWith(".json")) {
      const ipmap = IPMAP.parse(await fs.readFile(path.resolve(path.dirname(host), "ip-map"), "utf8"));
      const nf = NetworkFunction.parse(await fs.readFile(host, "utf8"));
      for (const [module, addrKey] of [["httpd", "j"], ["command", "u"]] as const) {
        const { config } = nf.getModule(module);
        assert(config.Acceptor.length > 0, "no acceptor");
        const { bind, port } = config.Acceptor[0]!;
        const addr = bind.startsWith("%") ? ipmap.resolveEnv(bind.slice(1)) : bind;
        assert(!!addr, "no acceptor IP address");
        addrs[addrKey] = [addr, port];
      }
    } else if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.exec(host)) {
      const ct = await new Dockerode().getContainer(host).inspect();
      const ip = ct.NetworkSettings.Networks["br-mgmt"]?.IPAddress;
      assert(!!ip, "no br-mgmt IP address");
      addrs.j[0] = ip;
      addrs.u[0] = ip;
    }
    clientJ = new PhoenixClientJSONRPC(...addrs.j);
    clientU = new PhoenixClientUDP(...addrs.u);
  })
  .command("$0 <cmd> [args..]", "execute remote command",
    (yargs) => yargs
      .positional("cmd", {
        demandOption: true,
        desc: "command name",
        type: "string",
      })
      .positional("args", {
        array: true,
        desc: "command arguments",
        type: "string",
      }),
    async ({ cmd, args = [] }) => {
      print(await clientU.executeCommand(cmd, args));
    },
  )
  .command("introspect", "introspect remote commands",
    (yargs) => yargs
      .option("json", {
        default: false,
        desc: "want JSON output",
        type: "boolean",
      }),
    async ({ json }) => {
      if (json) {
        print(await clientJ.request("remote_command.introspect", []));
      } else {
        print(await clientU.executeCommand("help", []));
      }
    },
  )
  .command("ue-status", "retrieve UE status", {},
    async () => {
      print(await ue5gStatus());
    },
  )
  .command("ue-register", "register UE",
    (yargs) => yargs
      .option("dnn", {
        array: true,
        desc: "data network names",
        nargs: 1,
        type: "string",
      }),
    async ({ dnn = [] }) => {
      await waitUntil(
        ue5gStatus,
        (status) => status.access_3gpp.mm_state_str === "MM_REGISTERED",
        () => clientJ.request("ue5g.register", { access_type: 1, no_pdu: dnn.length > 0 }),
      );

      for (const dn of dnn) {
        await waitUntil(
          ue5gStatus,
          (status) => status.pdu[dn]?.sm_state_str === "PDU_SESSION_ACTIVE",
          () => clientJ.request("ue5g.establish", { access_type: 1, DNN: dn, route: 1 }), // eslint-disable-line @typescript-eslint/no-loop-func
        );
      }
    },
  )
  .command("ue-deregister", "unregister UE", {},
    async () => {
      await waitUntil(
        ue5gStatus,
        (status) => status.access_3gpp.mm_state_str === "MM_DEREGISTERED",
        () => clientJ.request("ue5g.deregister", { access_type: 1 }),
      );
    },
  )
  .demandCommand()
  .parseAsync();
