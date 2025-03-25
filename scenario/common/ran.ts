
import { sortBy } from "sort-by-typescript";

import type { N } from "../../types/mod.js";
import { assert, decPad } from "../../util/mod.js";

export function addUEsPerGnb(network: N.Network, firstSUPI: string, total: number, sub: Partial<N.Subscriber>): void {
  const nGNBs = network.gnbs.length;
  assert(nGNBs >= 1);
  const gnbs = Array.from(network.gnbs, (gnb): [string, number] => [
    gnb.name,
    network.subscribers.filter((sub) => sub.gnbs!.includes(gnb.name)).reduce((cnt, sub) => cnt + sub.count!, 0),
  ]);
  gnbs.sort(sortBy("1", "0"));

  const each = Math.ceil(total / nGNBs);
  let supi = BigInt(firstSUPI);
  for (const [gnb] of gnbs) {
    if (total === 0) {
      break;
    }
    network.subscribers.push({
      ...sub,
      supi: decPad(supi, 15),
      count: Math.min(each, total),
      gnbs: [gnb],
    });
    total -= each;
    supi += BigInt(each);
  }
}

export function addUEsFullConnect(network: N.Network, firstSUPI: string, total: number, sub: Partial<N.Subscriber>): void {
  if (total === 0) {
    return;
  }
  network.subscribers.push({
    ...sub,
    supi: firstSUPI,
    count: total,
  });
}
