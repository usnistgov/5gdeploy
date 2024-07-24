import { Direction, type TrafficGen } from "./tgcs-defs.js";

export const ndnping: TrafficGen = {
  determineDirection() {
    return Direction.dl;
  },
  nPorts: 1,
  serverDockerImage: "ghcr.io/named-data/ndn-tools",
  serverPerDN: true,
  serverSetup(s, { prefix, sFlags }) {
    s.environment.NDN_CLIENT_TRANSPORT = "tcp://127.0.0.1";
    s.command = [
      "ndnpingserver",
      ...sFlags,
      `/${prefix}`,
    ];
  },
  clientDockerImage: "ghcr.io/named-data/ndn-tools",
  clientSetup(s, { prefix, cFlags }) {
    s.environment.NDN_CLIENT_TRANSPORT = "tcp://127.0.0.1";
    s.command = [
      "ndnping",
      ...cFlags,
      `/${prefix}`,
    ];
  },
  statsExt: ".log",
  *statsCommands() {
    yield "msg Showing ndnping final results from ndnping text output";
    yield "grep -wE 'packets transmitted|rtt min' ndnping_*-*-c.log";
  },
};
