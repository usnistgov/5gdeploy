import { js, ts } from "@yoursunny/xo-config";

/** @type {import("xo").FlatXoConfig} */
const config = [
  js,
  {
    files: [
      "**/*.ts",
    ],
    ...ts,
  },
];

export default config;
