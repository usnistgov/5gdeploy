import jayson from "jayson/promise/index.js";
import stripAnsi from "strip-ansi";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

let client: jayson.Client;

async function request(method: string, params: jayson.RequestParamsLike): Promise<any> {
  const { error, result } = await client.request(method, params);
  if (error) {
    process.stderr.write(`${JSON.stringify(error)}\n`);
    process.exit(1); // eslint-disable-line unicorn/no-process-exit
  }
  return result;
}

async function requestAndPrint(method: string, params: jayson.RequestParamsLike): Promise<any> {
  const result = await request(method, params);
  if (typeof result === "string") {
    process.stdout.write(`${result}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  return result;
}

async function executeRemoteCommand(cmd: string, args: readonly string[]): Promise<string> {
  const result = await request("remote_command.cmd", { command_name: cmd, command_parameters: args.join(" ") });
  let reply = "";
  if (result.command_reply) {
    reply = result.command_reply;
  } else if (Array.isArray(result.command_reply_list)) {
    reply = result.command_reply_list.join("\n");
  }

  const noColor = stripAnsi(reply);
  if (process.env.NO_COLOR) {
    reply = noColor;
  }

  process.stdout.write(`${reply}\n`);
  return noColor;
}

await yargs(hideBin(process.argv))
  .strict()
  .showHelpOnFail(false)
  .scriptName("phoenix-rpc")
  .option("host", {
    demandOption: true,
    desc: "server IP address",
    type: "string",
  })
  .option("port", {
    default: 10010,
    desc: "server port number",
    type: "number",
  })
  .middleware(({ host, port }) => {
    client = jayson.Client.http({
      host,
      port,
      path: "/jsonrpc",
      headers: {
        "Content-Type": "application/json",
      },
    });
  })
  .command("$0 <cmd> [args..]", "execute remote command", {}, async (argv) => {
    await executeRemoteCommand(argv.cmd as string, argv.args as string[]);
  })
  .command("introspect", "introspect remote commands", {}, async () => {
    await requestAndPrint("remote_command.introspect", []);
  })
  .command("ue-status", "retrieve UE status", {}, async () => {
    await requestAndPrint("ue5g.status", []);
  })
  .command("ue-register", "register UE", (yargs) => {
    yargs
      .option("dnn", {
        desc: "data network name",
        type: "string",
      });
  }, async (argv) => {
    const dnn = argv.dnn as string | undefined;

    const status = await requestAndPrint("ue5g.status", []);
    if (status.access_3gpp.mm_state_str !== "MM_REGISTERED") {
      await requestAndPrint("ue5g.register", { access_type: 1, no_pdu: !!dnn });
    }

    if (dnn && status.pdu[dnn]?.sm_state_str !== "PDU_SESSION_ACTIVE") {
      await requestAndPrint("ue5g.establish", { access_type: 1, DNN: dnn, route: 1 });
    }
  })
  .command("ue-deregister", "unregister UE", {}, async () => {
    const status = await requestAndPrint("ue5g.status", []);
    if (status.access_3gpp.mm_state_str !== "MM_DEREGISTERED") {
      await requestAndPrint("ue5g.deregister", { access_type: 1 });
    }
  })
  .demandCommand()
  .parseAsync();
