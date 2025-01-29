import { UndirectedGraph } from "graphology";
import { dijkstra } from "graphology-shortest-path";

import type { N } from "../types/mod.js";
import { findByName } from "../util/mod.js";

/**
 * User Plane topology in a graph data structure.
 */
export class UPGraph {
  private readonly g: UPGraph.Graph;

  constructor(network: N.Network) {
    this.g = buildGraph(network);
  }

  /**
   * Compute shortest path between a gNB and a Data Network.
   * @param gnb - gNB name.
   * @param dn - Data Network identifier.
   * @returns List of UPF names; `undefined` if path not found.
   */
  public computePath(gnb: string, dn: N.DataNetworkID): string[] | undefined {
    const p = dijkstra.bidirectional(this.g, gnb, dn.dnn, "cost");
    if (!p || p.length <= 2) {
      return undefined;
    }
    return p.slice(1, -1);
  }
}
export namespace UPGraph {
  export type Graph = UndirectedGraph<NodeAttr, EdgeAttr>;

  export interface NodeAttr {
    kind: "gNB" | "UPF" | "DN";
  }

  export interface EdgeAttr {
    kind: "N3" | "N9" | "N6";
    cost: number;
  }
}

function buildGraph(network: N.Network): UPGraph.Graph {
  const g: UPGraph.Graph = new UndirectedGraph({ allowSelfLoops: false });

  for (const gnb of network.gnbs) {
    g.addNode(gnb.name, {
      kind: "gNB",
    });
  }
  for (const upf of network.upfs) {
    g.addNode(upf.name, {
      kind: "UPF",
    });
  }
  for (const dn of network.dataNetworks) {
    g.addNode(dn.dnn, {
      kind: "DN",
    });
  }

  for (const [a, b, cost = 1] of network.dataPaths) {
    const [nameA, kindA] = parseNode(network, a);
    const [nameB, kindB] = parseNode(network, b);
    const nodeKinds = new Set([kindA, kindB]);
    const kind: UPGraph.EdgeAttr["kind"] =
      nodeKinds.has("gNB") ? "N3" :
      nodeKinds.has("DN") ? "N6" : "N9";
    g.addEdge(nameA, nameB, { kind, cost });
  }

  return g;
}

function parseNode(network: N.Network, node: N.DataPathNode): [name: string, kind: UPGraph.NodeAttr["kind"]] {
  if (typeof node !== "string") {
    return [node.dnn, "DN"];
  }
  if (findByName(node, network.upfs)) {
    return [node, "UPF"];
  }
  return [node, "gNB"];
}
