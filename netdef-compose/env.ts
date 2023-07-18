import { envSchema, type JSONSchemaType } from "env-schema";
import untildify from "untildify";

interface Env {
  /** Overall IP address space, at least /18 subnet. */
  D5G_IP_SPACE: string;

  /** Open5GCore cfg directory. */
  D5G_PHOENIX_CFG: string;
}

const schema: JSONSchemaType<Env> = {
  type: "object",
  required: [],
  properties: {
    D5G_IP_SPACE: {
      type: "string",
      default: "172.25.192.0/18",
    },
    D5G_PHOENIX_CFG: {
      type: "string",
      default: "~/phoenix-repo/phoenix-src/cfg",
    },
  },
};

export const env = envSchema({
  schema,
  dotenv: true,
  expandEnv: true,
});
env.D5G_PHOENIX_CFG = untildify(env.D5G_PHOENIX_CFG);
