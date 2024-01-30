import udp from "node:dgram";
import { stripVTControlCharacters } from "node:util";

import Dockerode from "dockerode";
import jayson from "jayson/promise/index.js";
import assert from "minimalistic-assert";
import { ip2long } from "netmask";
import { pEvent } from "p-event";

const noColor = (process.env.NO_COLOR ?? "") !== "";

/** Execute command in Open5GCore network function. */
export interface PhoenixClient {
  executeCommand(cmd: string, args: readonly string[]): Promise<PhoenixClient.ExecuteCommandResult>;
}
export namespace PhoenixClient {
  export interface ExecuteCommandResult {
    /** Text output, no color. */
    readonly text: string;
    /** Text output, possibly with console color. */
    readonly color: string;
  }
}

class CommandResult implements PhoenixClient.ExecuteCommandResult {
  constructor(private readonly raw: string) {
    this.text = stripVTControlCharacters(raw);
  }

  public readonly text: string;

  public get color(): string {
    return noColor ? this.text : this.raw;
  }
}

/** Interact with Open5GCore network function via JSON-RPC. */
export class PhoenixClientJSONRPC implements PhoenixClient {
  constructor(host: string, port: number) {
    this.jc = jayson.Client.http({
      host,
      port,
      path: "/jsonrpc",
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private readonly jc: jayson.Client;

  /** Send JSON-RPC request. */
  public async request(method: string, params: jayson.RequestParamsLike): Promise<any> {
    const { error, result } = await this.jc.request(method, params);
    if (error) {
      throw new Error(`JSON-RPC error: ${JSON.stringify(error)}`);
    }
    return result;
  }

  /** Execute remote command. */
  public async executeCommand(cmd: string, args: readonly string[]): Promise<PhoenixClient.ExecuteCommandResult> {
    const result = await this.request("remote_command.cmd", {
      command_name: cmd,
      command_parameters: args.join(" "),
    });
    let reply = "";
    if (result.command_reply) {
      reply = result.command_reply;
    } else if (Array.isArray(result.command_reply_list)) {
      reply = result.command_reply_list.join("\n");
    }
    return new CommandResult(reply);
  }
}

/** Interact with Open5GCore network function via UDP. */
export class PhoenixClientUDP implements PhoenixClient {
  constructor(private readonly host: string, private readonly port: number) {}

  /** Execute remote command. */
  public async executeCommand(cmd: string, args: readonly string[]): Promise<PhoenixClient.ExecuteCommandResult> {
    const sock = udp.createSocket("udp4");
    try {
      sock.connect(this.port, this.host);
      await pEvent(sock, "connect", { timeout: 1000 });
      sock.send(`${cmd} ${args.join(" ")}`);
      const result = (await pEvent(sock, "message", { timeout: 1000 })) as Buffer;
      return new CommandResult(result.toString("utf8"));
    } finally {
      sock.close();
    }
  }
}

export let dockerContainer: Dockerode.Container;
export let clientJ: PhoenixClientJSONRPC;
export let clientU: PhoenixClientUDP;

export async function createClients(
    { host, jsonrpcPort, udpPort }: { host: string; jsonrpcPort: number; udpPort: number },
): Promise<void> {
  let ip = "";
  try {
    ip2long(host);
    ip = host;
  } catch {}

  if (!ip) {
    const [ct, net = "mgmt"] = host.split(":");
    dockerContainer = new Dockerode().getContainer(ct!);
    const info = await dockerContainer.inspect();
    const network = info.NetworkSettings.Networks[`br-${net}`];
    assert(network, `no br-${net} IP address`);
    ip = network.IPAddress;
  }

  clientJ = new PhoenixClientJSONRPC(ip, jsonrpcPort);
  clientU = new PhoenixClientUDP(ip, udpPort);
}
