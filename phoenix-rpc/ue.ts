import multimatch from "multimatch";
import type { CommandModule } from "yargs";

import { PhoenixUE } from "../types/mod.js";
import { assert, dockerode } from "../util/mod.js";
import { clientJ, dockerContainer } from "./client.js";
import { print, waitUntil } from "./util.js";

function retrieveStatus(): Promise<PhoenixUE.Status> {
  return clientJ.request("ue5g.status", []);
}

export const ueStatus: CommandModule = {
  command: "ue-status",
  describe: "retrieve UE status",
  async handler() {
    print(await retrieveStatus());
  },
};

export const ueRegister: CommandModule<{ host: string }, { dnn: string[] }> = {
  command: "ue-register",
  describe: "register UE and establish PDU sessions",
  builder(yargs) {
    return yargs.option("dnn", {
      array: true,
      default: [],
      desc: "data network names",
      nargs: 1,
      type: "string",
    });
  },
  async handler({ host, dnn }) {
    if (dnn.some((dn) => /[?*]/.test(dn))) {
      assert(dockerContainer, "--dnn can have patterns only if --host refers to a Docker container");
      const exec = await dockerode.execCommand(dockerContainer, [
        "jq",
        ".Phoenix.Module[] | select(.binaryFile|endswith(\"ue_5g_nas_only.so\")) | .config.dn_list | map(.dnn)",
        `${host}.json`,
      ]);
      const configured: readonly string[] = JSON.parse(exec.stdout);
      dnn = multimatch(configured, dnn);
      print({ configured, selected: dnn });
    }

    await waitUntil(
      retrieveStatus,
      (status) => status.access_3gpp.mm_state === PhoenixUE.MMState.MM_REGISTERED,
      () => clientJ.request("ue5g.register", { access_type: 1, no_pdu: true }),
    );

    for (const dn of dnn) {
      await waitUntil(
        retrieveStatus,
        (status) => status.pdu[dn]?.sm_state === PhoenixUE.SMState.PDU_SESSION_ACTIVE,
        () => clientJ.request("ue5g.establish", { access_type: 1, DNN: dn, route: 1 }),
      );
    }
  },
};

export const ueDeregister: CommandModule = {
  command: "ue-deregister",
  describe: "unregister UE",
  async handler() {
    await waitUntil(
      retrieveStatus,
      (status) => status.access_3gpp.mm_state === PhoenixUE.MMState.MM_DEREGISTERED,
      () => clientJ.request("ue5g.deregister", { access_type: 1 }),
    );
  },
};
