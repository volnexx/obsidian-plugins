"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const target = path.join(__dirname, "main.js");
const bundle = fs.readFileSync(target, "utf8");

if (!bundle.includes("class extends import_obsidian5.Plugin")
  || !bundle.includes("data-vl-review-card-id")
  || !bundle.includes("getEligibleReviewCards")) {
  throw new Error("main.js не содержит обязательную интеграцию Virtual Linker");
}

new vm.Script(bundle, { filename: target });
console.log("Собран установленный bundle Virtual Linker: main.js");
