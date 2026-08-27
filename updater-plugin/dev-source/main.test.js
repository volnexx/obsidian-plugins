const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const notices = [];
const Platform = { isDesktopApp: true, isMobileApp: false, isIosApp: false, isLinux: true };

class FileSystemAdapter {
  constructor(basePath = "/vault") { this.basePath = basePath; }
  getBasePath() { return this.basePath; }
}

class Plugin {
  constructor(app = {}, manifest = { id: "updater-plugin", version: "0.11.1" }) {
    this.app = app;
    this.manifest = manifest;
  }
  async loadData() { return {}; }
  async saveData() {}
  addRibbonIcon(_icon, _title, callback) {
    return {
      style: {}, callback, attrs: {}, children: [],
      classList: { toggle() {} },
      setAttribute(name, value) { this.attrs[name] = value; },
      appendChild(child) { this.children.push(child); }
    };
  }
  addCommand() {}
  addSettingTab() {}
  registerEvent() {}
  registerInterval() {}
}

class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty() {}, createEl() {} }; }
}

class Setting {
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addButton() { return this; }
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin, PluginSettingTab, Setting,
      Notice: class Notice { constructor(message) { notices.push(String(message)); } },
      requestUrl: async () => { throw new Error("network disabled in tests"); },
      FileSystemAdapter,
      Platform,
      normalizePath: value => String(value).replace(/\\/g, "/"),
      setIcon() {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const UpdaterPlugin = require("./main.js");
const helpers = UpdaterPlugin.__test;

test.after(() => { Module._load = originalLoad; });

function appFixture(adapter = new FileSystemAdapter()) {
  return {
    vault: { adapter, configDir: ".obsidian" },
    workspace: { onLayoutReady() {}, on() { return {}; }, getLeavesOfType() { return []; } },
    plugins: { plugins: {} }
  };
}

test("dev 1.2.0 beats GitHub 1.1.0", () => {
  assert.equal(helpers.decideSync("1.2.0", "1.1.0", "dev", "remote"), "dev-to-github");
});

test("GitHub 1.2.0 beats dev 1.1.0", () => {
  assert.equal(helpers.decideSync("1.1.0", "1.2.0", "dev", "remote"), "github-to-dev");
});

test("same version and same project hash is a no-op", () => {
  assert.equal(helpers.decideSync("1.2.0", "1.2.0", "same", "same"), "noop");
});

test("same version and different project hashes is a conflict", () => {
  assert.equal(helpers.decideSync("1.2.0", "1.2.0", "dev", "remote"), "conflict");
});

function stubDesktopSync(plugin, items) {
  plugin.isDesktopApp = true;
  plugin.node = { path: require("node:path") };
  plugin.settings = { registryBranch: "centralize-plugins" };
  plugin.ensureGitCheckout = async () => "/checkout";
  plugin.buildDesktopSyncPlan = async () => ({ registry: { plugins: [] }, items });
  plugin.readInstalledPlugins = async () => new Map();
  plugin.iphoneMirrorIsCurrent = async () => false;
  plugin.assertUpdateUnlocked = async () => true;
  plugin.createVaultBackup = async () => "/backup";
  plugin.readCheckoutRegistry = async () => ({ file: "/checkout/registry.json", registry: { schemaVersion: 2, plugins: [] } });
  plugin.gitHead = async () => "main-old";
  plugin.writeDesktopJsonAtomic = async () => {};
  plugin.commitCheckout = async () => "main-new";
  plugin.pushAndVerify = async () => "main-new";
  plugin.rebuildIphoneMirror = async () => ({ changed: true, count: 2, sha: "iphone-new" });
  global.window = { location: { reload() {} }, setInterval: () => 1 };
}

test("dev winner is published, verified, copied to runtime and mirrored", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const project = { id: "activity", version: "1.2.0", dir: "/dev/activity", manifest: { id: "activity", name: "Activity", version: "1.2.0" } };
  stubDesktopSync(plugin, [{ decision: "dev-to-github", project, entry: { id: "activity", path: "activity" } }]);
  let checks = 0;
  let staged = 0;
  let runtime = 0;
  let mirror = 0;
  plugin.runProjectChecks = async () => { checks++; };
  plugin.readDesktopJson = async () => project.manifest;
  plugin.stageMainRepositoryPlugin = async () => {
    staged++;
    return { id: "activity", name: "Activity", version: "1.2.0", path: "activity", sourceComplete: true };
  };
  plugin.listDevProjects = async () => [project];
  plugin.updateRuntimeFromProjects = async projects => { runtime += projects.length; return projects.length; };
  plugin.rebuildIphoneMirror = async () => { mirror++; return { changed: true, count: 1, sha: "iphone-new" }; };
  const result = await plugin.safeDesktopSynchronizeAll();
  assert.equal(checks, 1);
  assert.equal(staged, 1);
  assert.equal(runtime, 1);
  assert.equal(mirror, 1);
  assert.equal(result.devToGithub, 1);
  assert.equal(result.mainSha, "main-new");
});

test("GitHub winner is validated, applied to dev and copied to runtime", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const oldProject = { id: "activity", version: "1.1.0", dir: "/dev/activity", manifest: { id: "activity", name: "Activity", version: "1.1.0" } };
  const newProject = { ...oldProject, version: "1.2.0", manifest: { ...oldProject.manifest, version: "1.2.0" } };
  const item = { decision: "github-to-dev", project: oldProject, entry: { id: "activity", name: "Activity", version: "1.2.0", sourceComplete: true } };
  stubDesktopSync(plugin, [item]);
  let prepared = 0;
  let applied = 0;
  let runtime = 0;
  plugin.prepareIncomingProject = async value => { prepared++; return { ...value, incomingDir: "/incoming" }; };
  plugin.applyIncomingProject = async () => { applied++; return newProject; };
  plugin.listDevProjects = async () => [newProject];
  plugin.updateRuntimeFromProjects = async projects => { runtime += projects.length; return projects.length; };
  const result = await plugin.safeDesktopSynchronizeAll();
  assert.equal(prepared, 1);
  assert.equal(applied, 1);
  assert.equal(runtime, 1);
  assert.equal(result.githubToDev, 1);
});

test("no-op performs no backup, publication or runtime write", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const project = { id: "activity", version: "1.2.0", dir: "/dev/activity", manifest: { id: "activity", version: "1.2.0" } };
  stubDesktopSync(plugin, [{ decision: "noop", project, entry: { id: "activity", version: "1.2.0" } }]);
  plugin.iphoneMirrorIsCurrent = async () => true;
  plugin.runtimeProjectNeedsUpdate = async () => false;
  let writes = 0;
  plugin.createVaultBackup = async () => { writes++; return "/backup"; };
  plugin.updateRuntimeFromProjects = async () => { writes++; return 0; };
  const result = await plugin.safeDesktopSynchronizeAll();
  assert.equal(writes, 0);
  assert.equal(result.devToGithub, 0);
});

test("equal-version conflict skips both sides and continues without overwrite", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const project = { id: "priority-recall", version: "0.30.0", dir: "/dev/priority-recall", manifest: { id: "priority-recall", name: "Priority Recall", version: "0.30.0" } };
  stubDesktopSync(plugin, [{ decision: "conflict", project, entry: { id: "priority-recall", version: "0.30.0" }, reason: "different hashes" }]);
  plugin.iphoneMirrorIsCurrent = async () => true;
  let writes = 0;
  plugin.createVaultBackup = async () => { writes++; return "/backup"; };
  plugin.stageMainRepositoryPlugin = async () => { writes++; };
  plugin.applyIncomingProject = async () => { writes++; };
  const result = await plugin.safeDesktopSynchronizeAll();
  assert.equal(writes, 0);
  assert.equal(result.conflicts, 1);
});

test("mobile plugin is eligible for the iPhone mirror", () => {
  assert.equal(helpers.isMobileEligible({ id: "updater-plugin", isDesktopOnly: false }), true);
  assert.equal(helpers.isMobileEligible({ id: "activity" }), true);
});

test("desktop-only manifest and PC-only denylist never enter iPhone mirror", () => {
  assert.equal(helpers.isMobileEligible({ id: "git", isDesktopOnly: true }), false);
  assert.equal(helpers.isMobileEligible({ id: "parsing", isDesktopOnly: false }), false);
  assert.ok(helpers.pcOnlyPluginIds.includes("obsidian42-brat"));
  assert.ok(helpers.pcOnlyPluginIds.includes("mrj-jump-to-link"));
});

test("project hash exclusions cover caches, backups, user data and Codex lock", () => {
  for (const file of [
    "node_modules/x.js", ".git/config", "coverage/a.json", "build-cache/a",
    "data.json", ".codex-active.json", "x.tmp", "mobile-backups/one/main.js",
    "rollback/plugin/main.js", "file.sync-conflict-2026.md"
  ]) assert.equal(helpers.isExcludedProjectPath(file), true, file);
  assert.equal(helpers.isExcludedProjectPath("src/main.ts"), false);
  assert.equal(helpers.isExcludedProjectPath("manifest.json"), false);
});

function codexLockPlugin() {
  const plugin = new UpdaterPlugin(appFixture());
  plugin.isDesktopApp = true;
  plugin.node = {};
  plugin.getDesktopVaultPath = () => "/vault";
  plugin.removeStaleCodexLock = async () => {};
  return plugin;
}

function freshDevLock(overrides = {}) {
  return {
    path: "/vault/dev/.codex-active.json",
    data: {
      scope: "dev/**",
      paths: ["dev/updater-plugin"],
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      ...overrides
    }
  };
}

test("running Codex process without a lock does not block P", async () => {
  const plugin = codexLockPlugin();
  let processScans = 0;
  plugin.scanActiveCodexProcesses = async () => { processScans++; return true; };
  plugin.readCodexLock = async () => null;
  const state = await plugin.getCodexLockState();
  assert.deepEqual(state, { active: false, reason: "no-lock" });
  assert.equal(processScans, 0);
});

test("Copilot work outside dev does not block P", async () => {
  const plugin = codexLockPlugin();
  let removed = false;
  plugin.readCodexLock = async () => freshDevLock({
    scope: "copilot/**",
    paths: ["copilot/projects/notes"],
    workspace: "/vault/copilot/projects/notes"
  });
  plugin.removeStaleCodexLock = async () => { removed = true; };
  const state = await plugin.getCodexLockState();
  assert.deepEqual(state, { active: false, reason: "non-dev-lock-removed" });
  assert.equal(removed, true);
});

test("fresh dev-scoped lock blocks safeUpdateAll before any work", async () => {
  const plugin = codexLockPlugin();
  plugin.readCodexLock = async () => freshDevLock();
  let syncCalls = 0;
  plugin.safeDesktopSynchronizeAll = async () => { syncCalls++; };
  await plugin.safeUpdateAll();
  assert.equal(syncCalls, 0);
  assert.equal(plugin._busy, undefined);
  assert.equal(plugin._codexBlocked, true);
  assert.ok(notices.at(-1)?.includes("активна сессия Codex"));
});

test("removing the lock immediately restores ribbon and Settings state", async () => {
  const plugin = codexLockPlugin();
  let lock = freshDevLock();
  plugin.readCodexLock = async () => lock;
  plugin._updateRibbon = {
    attrs: {},
    classList: { toggle() {} },
    setAttribute(name, value) { this.attrs[name] = value; }
  };
  let settingsDisabled = null;
  plugin.registerLockButton({ setDisabled(value) { settingsDisabled = value; } });

  assert.equal(await plugin.refreshCodexState(), true);
  assert.equal(plugin._updateRibbon.attrs["aria-disabled"], "true");
  assert.equal(settingsDisabled, true);

  lock = null;
  assert.equal(await plugin.refreshCodexState(), false);
  assert.equal(plugin._updateRibbon.attrs["aria-disabled"], "false");
  assert.equal(settingsDisabled, false);
});

test("lock appearing after initial check cancels before backup or write", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  plugin.isDesktopApp = true;
  plugin.node = { path: require("node:path") };
  plugin.settings = { registryBranch: "centralize-plugins" };
  let checks = 0;
  let backups = 0;
  plugin.assertUpdateUnlocked = async () => ++checks === 1;
  plugin.ensureGitCheckout = async () => "/checkout";
  plugin.buildDesktopSyncPlan = async () => ({ registry: { plugins: [] }, items: [{ decision: "dev-to-github", project: { id: "p" } }] });
  plugin.readInstalledPlugins = async () => new Map();
  plugin.iphoneMirrorIsCurrent = async () => false;
  plugin.createVaultBackup = async () => { backups++; return "/backup"; };
  await plugin.safeUpdateAll();
  assert.equal(checks, 2);
  assert.equal(backups, 0);
});

test("stale heartbeat is removed and cannot block forever", async () => {
  const plugin = codexLockPlugin();
  let removed = false;
  plugin.readCodexLock = async () => freshDevLock({
    startedAt: "2026-08-27T07:00:00.000Z",
    heartbeatAt: "2026-08-27T07:00:00.000Z"
  });
  plugin.removeStaleCodexLock = async () => { removed = true; };
  const state = await plugin.getCodexLockState(Date.parse("2026-08-27T07:06:00.000Z"));
  assert.deepEqual(state, { active: false, reason: "stale-lock-removed" });
  assert.equal(removed, true);
});

test("lock watcher refreshes shared UI state when the lock file changes", () => {
  const plugin = codexLockPlugin();
  let watcherCallback = null;
  let refreshes = 0;
  plugin.node = {
    path: require("node:path"),
    fs: {
      watch(_dir, _options, callback) {
        watcherCallback = callback;
        return { close() {} };
      }
    }
  };
  plugin.refreshCodexState = async () => { refreshes++; };
  plugin.setupCodexLockWatcher();
  watcherCallback("rename", ".codex-active.json");
  assert.equal(refreshes, 1);
});

test("mobile onload does not require child_process/process checks and uses iPhone repo", async () => {
  Platform.isDesktopApp = false;
  Platform.isMobileApp = true;
  Platform.isIosApp = true;
  let childProcessLoads = 0;
  Module._load = function(request, parent, isMain) {
    if (request === "child_process") childProcessLoads++;
    if (request === "obsidian") return originalLoad.call(this, request, parent, isMain);
    return originalLoad.call(this, request, parent, isMain);
  };
  global.document = { createElement: () => ({ style: {}, setAttribute() {} }) };
  const plugin = new UpdaterPlugin(appFixture({}));
  plugin.setupCodexStateMonitoring = () => assert.fail("mobile must not start Codex monitor");
  await plugin.onload();
  assert.equal(plugin.node, null);
  assert.equal(childProcessLoads, 0);
  assert.equal(plugin.getRegistryRepo(), "volnexx/obsidian-plugins-iphone");
  Module._load = originalLoad;
});

test("mock onload works on desktop", async () => {
  Platform.isDesktopApp = true;
  Platform.isMobileApp = false;
  Platform.isIosApp = false;
  global.document = { createElement: () => ({ style: {}, setAttribute() {} }) };
  global.window = { setInterval: () => 1 };
  const plugin = new UpdaterPlugin(appFixture());
  let monitoring = 0;
  plugin.setupCodexStateMonitoring = () => { monitoring++; };
  await plugin.onload();
  assert.ok(plugin.node?.fsp);
  assert.equal(plugin.getRegistryRepo(), "volnexx/obsidian-plugins");
  assert.equal(monitoring, 1);
});
