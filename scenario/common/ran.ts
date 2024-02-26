import assert from "minimalistic-assert";
import type { Options } from "yargs";

import type { N } from "../../types/mod.js";
import { decPad } from "../../util/mod.js";

export function option(desc: string, dflt: number, max: number, min = 1) {
  return {
    desc: `${desc} quantity (${min}..${max})`,
    default: dflt,
    type: "number",
    coerce(arg) {
      const n = Number(arg);
      if (!Number.isSafeInteger(n) || n < min || n > max) {
        throw new RangeError(`must be between ${min} and ${max}`);
      }
      return n;
    },
  } satisfies Options;
}

export function addUEsPerGNB(network: N.Network, firstSUPI: string, total: number, subscribedNSSAI: N.SubscriberSNSSAI[]): void {
  const nGNBs = network.gnbs.length;
  assert(nGNBs >= 1);
  const each = Math.ceil(total / nGNBs);
  let supi = BigInt(firstSUPI);
  for (let i = 0; i < nGNBs && total > 0; ++i) {
    network.subscribers.push({
      supi: decPad(supi, 15),
      count: Math.min(each, total),
      subscribedNSSAI,
      gnbs: [network.gnbs[i]!.name!],
    });
    total -= each;
    supi += BigInt(each);
  }
}
