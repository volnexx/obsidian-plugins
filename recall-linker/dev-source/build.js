"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const source = path.join(root, "src", "main.bundle.js");
const target = path.join(root, "main.js");
const bundle = fs.readFileSync(source, "utf8");

if (!bundle.includes("class extends import_obsidian5.Plugin") || !bundle.includes("recall-linker")) {
  throw new Error("Исходный bundle recall-linker повреждён");
}
fs.writeFileSync(target, bundle);
console.log("Собран main.js");
