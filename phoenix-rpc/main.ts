import { Yargs } from "../util/yargs.js";
import { clientJ, clientU, createClients } from "./client.js";
import { ueDeregister, ueRegister, ueStatus } from "./ue.js";
import { print } from "./util.js";

await Yargs()
  .scriptName("phoenix-rpc")
  .option("host", {
    demandOption: true,
    desc: "network function IP address or Docker container name",
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
  .middleware(createClients)
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
  .command(ueStatus)
  .command(ueRegister)
  .command(ueDeregister)
  .demandCommand()
  .parseAsync();
