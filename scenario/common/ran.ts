
import type { N } from "../../types/mod.js";
import { assert, decPad } from "../../util/mod.js";

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
