/** @typedef {import("xo").Options} XoOptions */

/** @type {import("@yoursunny/xo-config")} */
const { js, ts, preact, merge } = require("@yoursunny/xo-config");

/** @type {XoOptions} */
module.exports = {
  ...js,
  overrides: [
    {
      files: [
        "./*.ts",
      ],
      ...merge(js, ts),
    },
    {
      files: [
        "./src/**/*.(ts|tsx)",
      ],
      ...merge(js, ts, preact),
    },
  ],
};
