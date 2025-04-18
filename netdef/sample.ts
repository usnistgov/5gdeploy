import type { N } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import * as netdef from "./helpers.js";

const network: N.Network = {
  plmn: "001-01",
  gnbIdLength: 24,
  tac: "000005",
  subscribers: [
    {
      supi: "001017005550100",
      count: 3,
      k: "06CEC946EF2062CC797073B5BBA4CF4E",
      opc: "5F4D5BF95F2C2899895127D3532F4B7C",
      subscribedNSSAI: [
        { snssai: "01", dnns: ["net6", "net3"] },
      ],
      requestedNSSAI: [
        { snssai: "01", dnns: ["net6", "net3"] },
      ],
    },
    {
      supi: "001017005550200",
      k: "CAACEF305C52DF9A00E5D92DD47AFA68",
      opc: "E3B7A2C7EFA7770E7509F33FA8716194",
      requestedNSSAI: [
        { snssai: "90000001", dnns: ["net5"] },
      ],
    },
    {
      supi: "001017005550300",
      requestedNSSAI: [
        { snssai: "90000001", dnns: ["net5"] },
        { snssai: "01", dnns: ["net6"] },
      ],
      gnbs: ["gnb2"],
    },
  ],
  gnbs: [
    {
      name: "gnb1",
      nci: "000001001",
    },
    {
      name: "gnb2",
      nci: "000002002",
    },
  ],
  amfs: [
    {
      name: "amf1",
      amfi: [1, 1, 0],
      // nssai: ["01"],
    },
    {
      name: "amf2",
      amfi: [1, 2, 0],
      // nssai: ["90000001"],
    },
  ],
  smfs: [
    {
      name: "smf1",
      nssai: ["01"],
    },
    {
      name: "smf2",
      nssai: ["90000001"],
    },
  ],
  upfs: [
    { name: "upf1" },
    { name: "upf2" },
    { name: "upf3" },
  ],
  dataNetworks: [
    { snssai: "01", dnn: "ethernet", type: "Ethernet" },
    { snssai: "01", dnn: "net6", type: "IPv4", subnet: "192.168.6.0/24" },
    { snssai: "01", dnn: "net3", type: "IPv4", subnet: "192.168.3.0/24" },
    { snssai: "90000001", dnn: "net5", type: "IPv4", subnet: "192.168.5.0/24" },
  ],
  dataPaths: [
    ["gnb1", "upf1"],
    ["gnb2", "upf2"],
    ["upf1", "upf2"],
    ["upf1", "upf3"],
    ["upf1", { snssai: "01", dnn: "net6" }],
    ["upf2", { snssai: "01", dnn: "net3" }],
    ["upf2", { snssai: "90000001", dnn: "net5" }],
    ["upf3", { snssai: "01", dnn: "ethernet" }],
  ],
};

netdef.validate(network);
await file_io.write("-.json", network);
