import { fileURLToPath } from "node:url";

export const phoenixdir = "/opt/phoenix";
export const cfgdir = `${phoenixdir}/cfg/current`;
export const __dirname = fileURLToPath(new URL(".", import.meta.url));
