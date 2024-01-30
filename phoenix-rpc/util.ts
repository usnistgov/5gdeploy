import { setTimeout as delay } from "node:timers/promises";

import type { PhoenixClient } from "./client.js";

export function print<T>(value: T): T {
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

export async function waitUntil<T>(
    retrieve: () => Promise<T>,
    predicate: (status: T) => boolean,
    change: () => Promise<void>,
    {
      silent = false,
      interval = 500,
      timeout = 30000,
    }: waitUntil.Options = {},
): Promise<void> {
  let status = await retrieve();
  if (!silent) {
    print(status);
  }

  if (predicate(status)) {
    return;
  }
  await change();

  let limit = Math.ceil(timeout / interval);
  while (true) {
    await delay(interval);
    status = await retrieve();
    if (predicate(status)) {
      if (!silent) {
        print(status);
      }
      return;
    }
    if (--limit < 0) {
      if (!silent) {
        print(status);
      }
      throw new Error("condition not fulfilled within timeout");
    }
  }
}
export namespace waitUntil {
  export interface Options {
    silent?: boolean;
    interval?: number;
    timeout?: number;
  }
}
