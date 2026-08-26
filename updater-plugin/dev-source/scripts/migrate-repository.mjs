#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const RUNTIME_FILES = ["main.js", "manifest.json", "styles.css"];
const PC_ONLY = new Set([
  "copilot", "gpt-obsidian", "memory-monitor-ru", "focus-zen-black", "lite-tabs",
  "workspace-plus-plus", "parsing", "obsidian42-brat", "mrj-jump-to-link", "vault-text-autocomplete"
]);
const EXCLUDED_SEGMENTS = new Set([
  ".git", "node_modules", ".cache", ".parcel-cache", ".turbo", ".next", "coverage",
  "dist", "build", "build-cache", ".updater-sync", "mobile-backups", "self-rollback",
  "rollback", "backups"
]);

function excluded(relative) {
  const normalized = relative.replaceAll("\\", "/").replace(/^\.\//u, "");
  const parts = normalized.split("/");
  if (parts.some(part => EXCLUDED_SEGMENTS.has(part))) return true;
  const name = parts.at(-1);
  return name === ".codex-active.json" || name === "data.json" || name === ".DS_Store" ||
    /(?:\.log|\.tmp|\.swp|\.swo|~)$/iu.test(name) || /(?:^|\.)(?:conflict|sync-conflict)-/iu.test(name) ||
    /(?:^|[._-])backup(?:[._-]|$)/iu.test(name);
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function files(root, relative = "", result = []) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (excluded(rel)) continue;
    if (entry.isDirectory()) await files(root, rel, result);
    else if (entry.isFile()) result.push(rel);
  }
  return result;
}

async function hashFiles(root, selected) {
  const hash = createHash("sha256");
  for (const relative of [...selected].sort((a, b) => a.localeCompare(b, "en"))) {
    const data = await readFile(path.join(root, relative));
    hash.update(relative); hash.update("\0"); hash.update(String(data.length)); hash.update("\0"); hash.update(data); hash.update("\0");
  }
  return hash.digest("hex");
}

async function projectHash(root) { return hashFiles(root, await files(root)); }

async function runtimeFiles(root) {
  const result = [];
  for (const file of RUNTIME_FILES) if (await exists(path.join(root, file))) result.push(file);
  if (!result.includes("main.js") || !result.includes("manifest.json")) throw new Error(`${root}: no main.js/manifest.json`);
  return result;
}

async function copyProject(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const relative of await files(source)) {
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(source, relative), target);
  }
}

function compare(a, b) {
  const aa = String(a).split(".").map(Number), bb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if ((aa[i] || 0) > (bb[i] || 0)) return 1;
    if ((aa[i] || 0) < (bb[i] || 0)) return -1;
  }
  return 0;
}

function mobileEligible(manifest) {
  return manifest.isDesktopOnly !== true && !PC_ONLY.has(manifest.id);
}

async function atomicPlugin(source, repo, pluginPath, current) {
  const final = path.join(repo, pluginPath);
  const stage = path.join(repo, `.migration-stage-${source.manifest.id}`);
  const old = `${final}.migration-old`;
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  if (await exists(final)) {
    for (const entry of await readdir(final, { withFileTypes: true })) {
      await cp(path.join(final, entry.name), path.join(stage, entry.name), { recursive: true, force: true });
    }
  }
  const runtime = await runtimeFiles(source.dir);
  for (const file of runtime) await cp(path.join(source.dir, file), path.join(stage, file));
  await copyProject(source.dir, path.join(stage, "dev-source"));
  await mkdir(path.dirname(final), { recursive: true });
  await rm(old, { recursive: true, force: true });
  if (await exists(final)) await rename(final, old);
  await rename(stage, final);
  await rm(old, { recursive: true, force: true });
  return {
    id: source.manifest.id,
    name: source.manifest.name || source.manifest.id,
    version: source.manifest.version,
    path: pluginPath,
    sourcePath: `${pluginPath}/dev-source`,
    sourceHash: await projectHash(path.join(final, "dev-source")),
    runtimeHash: await hashFiles(final, runtime),
    runtimeFiles: runtime,
    sourceComplete: true,
    isDesktopOnly: source.manifest.isDesktopOnly === true,
    mobile: mobileEligible(source.manifest)
  };
}

async function main() {
  const [vault, repository, mode = "--dry-run"] = process.argv.slice(2);
  if (!vault || !repository || !["--dry-run", "--apply"].includes(mode)) {
    throw new Error("Usage: node scripts/migrate-repository.mjs <vault> <main-checkout> [--dry-run|--apply]");
  }
  const devRoot = path.join(vault, "dev");
  const policy = JSON.parse(await readFile(path.join(devRoot, ".plugin-sync-policy.json"), "utf8"));
  const registryPath = path.join(repository, "registry.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const byId = new Map(registry.plugins.map(entry => [entry.id, entry]));
  const decisions = [];

  for (const dirent of (await readdir(devRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const dir = path.join(devRoot, dirent.name);
    if (!(await exists(path.join(dir, "manifest.json")))) continue;
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    const current = byId.get(manifest.id);
    if (policy.blocked?.[manifest.id]) {
      decisions.push({ id: manifest.id, decision: "blocked", reason: policy.blocked[manifest.id] });
      continue;
    }
    let decision = "publish";
    let reason = current ? "newer dev" : "new plugin";
    if (current && compare(manifest.version, current.version) < 0) {
      decision = "blocked"; reason = "remote runtime is newer and has no safe full source";
    } else if (current && compare(manifest.version, current.version) === 0 && current.sourceComplete !== true) {
      const remoteDir = path.join(repository, current.path);
      const selected = await runtimeFiles(dir);
      const same = await hashFiles(dir, selected) === await hashFiles(remoteDir, selected);
      if (!same) { decision = "conflict"; reason = "same version, different runtime content"; }
      else reason = "safe runtime-only migration";
    }
    decisions.push({ id: manifest.id, version: manifest.version, decision, reason });
    if (mode === "--apply" && decision === "publish") {
      byId.set(manifest.id, await atomicPlugin({ dir, manifest }, repository, current?.path || manifest.id, current));
    }
  }

  if (mode === "--apply") {
    for (const [id, entry] of byId) {
      const dir = path.join(repository, entry.path);
      if (!(await exists(path.join(dir, "manifest.json")))) continue;
      const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
      const runtime = await runtimeFiles(dir);
      byId.set(id, {
        ...entry,
        runtimeHash: await hashFiles(dir, runtime),
        runtimeFiles: runtime,
        isDesktopOnly: manifest.isDesktopOnly === true,
        mobile: mobileEligible(manifest)
      });
    }
    registry.schemaVersion = 2;
    registry.plugins = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
    await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
  }
  for (const item of decisions) console.log(`${item.decision.padEnd(8)} ${item.id} ${item.version || ""} — ${item.reason}`);
}

await main();
