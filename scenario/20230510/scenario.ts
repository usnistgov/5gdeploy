import type { N } from "../../types/mod.js";
import { file_io } from "../../util/mod.js";

const network: N.Network = {
  plmn: "001-01",
  gnbIdLength: 24,
  tac: "000005",
  subscribers: [
    {
      supi: "001017005551001",
      count: 2,
      subscribedNSSAI: [
        { snssai: "01", dnns: ["cloud"] },
        { snssai: "81", dnns: ["edge1"] },
      ],
      gnbs: ["gnb1"],
    },
    {
      supi: "001017005552001",
      count: 2,
      subscribedNSSAI: [
        { snssai: "01", dnns: ["cloud"] },
        { snssai: "82", dnns: ["edge2"] },
      ],
      gnbs: ["gnb2"],
    },
  ],
  gnbs: [
    { name: "gnb1" },
    { name: "gnb2" },
  ],
  upfs: [
    { name: "upf0" },
    { name: "upf1" },
    { name: "upf2" },
  ],
  dataNetworks: [
    { snssai: "01", dnn: "cloud", type: "IPv4", subnet: "10.1.0.0/16" },
    { snssai: "81", dnn: "edge1", type: "IPv4", subnet: "10.129.0.0/16" },
    { snssai: "82", dnn: "edge2", type: "IPv4", subnet: "10.130.0.0/16" },
  ],
  dataPaths: {
    links: [
      ["upf0", { snssai: "01", dnn: "cloud" }],
      ["upf1", { snssai: "81", dnn: "edge1" }],
      ["upf1", "upf0"],
      ["gnb1", "upf1"],
      ["upf2", { snssai: "82", dnn: "edge2" }],
      ["upf2", "upf0"],
      ["gnb2", "upf2"],
    ],
  },
};

await file_io.write("-.json", network);
