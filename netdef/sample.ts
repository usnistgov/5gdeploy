import type { Network } from "../types/netdef.js";

const network: Network = {
  plmn: "001-01",
  gnbIdLength: 24,
  tac: "0075",
  subscribers: [
    {
      supi: "001017005550001",
      k: "06CEC946EF2062CC797073B5BBA4CF4E",
      opc: "5F4D5BF95F2C2899895127D3532F4B7C",
      requestedNSSAI: ["01"],
    },
    {
      supi: "001017005550002",
      k: "CAACEF305C52DF9A00E5D92DD47AFA68",
      opc: "E3B7A2C7EFA7770E7509F33FA8716194",
      requestedNSSAI: ["90000001", "90000002"],
    },
  ],
  gnbs: [
    {
      name: "gnb1",
      ncgi: "000001001",
    },
  ],
  upfs: [
    { name: "upf1" },
    { name: "upf2" },
  ],
  dataNetworks: [
    { snssai: "01", dnn: "net6", type: "IPv4", subnet: "192.168.6.0/24" },
    { snssai: "90000001", dnn: "net3", type: "IPv4", subnet: "192.168.3.0/24" },
    { snssai: "90000002", dnn: "net5", type: "IPv4", subnet: "192.168.5.0/24" },
  ],
  dataPaths: {
    links: [
      ["gnb1", "upf1"],
      ["upf1", { snssai: "01", dnn: "net6" }],
      ["upf1", { snssai: "90000001", dnn: "net3" }],
      ["gnb1", "upf2"],
      ["upf2", { snssai: "90000002", dnn: "net5" }],
    ],
  },
};

process.stdout.write(`${JSON.stringify(network)}\n`);
