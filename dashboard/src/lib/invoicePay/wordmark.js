/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const fs = require("node:fs");
const path = require("node:path");

/**
 * Cropped from dashboard/public/brand/logo-full.png onto white.
 * JPEG so the PDF can embed it without a PNG decoder.
 */
const bytes = fs.readFileSync(path.join(__dirname, "wordmark.jpg"));

module.exports = {
  bytes,
  width: 840,
  height: 321,
  dataUri: `data:image/jpeg;base64,${bytes.toString("base64")}`,
};
