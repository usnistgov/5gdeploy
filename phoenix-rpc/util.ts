import { setTimeout as delay } from "node:timers/promises";

import type { PhoenixClient } from "./client.js";

/**
 * Print a value to console.
 * @param value - Output value, possibly a {@link PhoenixClient.ExecuteCommandResult}.
 * @returns `value`
 */
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

/**
 * Wait until a condition becomes true.
 * @param retrieve - Action to retrieve the status.
 * @param predicate - Predicate to determine whether the condition is met based on the status.
 * @param change - Action to make a change that would cause the condition to become fulfilled.
 * This is invoked only once, after an initial check that the condition is not already met.
 * @returns Promise that resolves when the condition is met or rejects when it cannot be met.
 */
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
    /** If true, status will not be printed. */
    silent?: boolean;
    /** How often to retrieve status. */
    interval?: number;
    /** Timeout waiting for the change to happen. */
    timeout?: number;
  }
}
