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
  constructor(app = {}, manifest = { id: "updater-plugin", version: "0.11.4" }) {
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

function gitCheckoutFixture({ status = "", relation = "0 0" } = {}) {
  const plugin = new UpdaterPlugin(appFixture());
  const calls = [];
  const recoveries = [];
  plugin.node = {
    path: require("node:path"),
    fsp: {
      async mkdir() {},
      async readdir() { return []; },
      async rmdir() {}
    }
  };
  plugin.getDesktopSyncRoot = () => "/sync";
  plugin.desktopExists = async value => value === "/sync/main" || value === "/sync/main/.git";
  plugin.runDesktopProcess = async (command, args, options = {}) => {
    calls.push({ command, args: [...args], cwd: options.cwd });
    const operation = args.join(" ");
    if (operation === "status --porcelain") return { stdout: status };
    if (operation === "remote get-url origin") return { stdout: "https://github.com/volnexx/obsidian-plugins.git" };
    if (operation === "symbolic-ref --short HEAD") return { stdout: "centralize-plugins" };
    if (operation === "fetch origin centralize-plugins") return { stdout: "" };
    if (operation === "rev-list --left-right --count HEAD...origin/centralize-plugins") return { stdout: relation };
    if (operation === "merge --ff-only origin/centralize-plugins") return { stdout: "" };
    throw new Error(`unexpected git operation: ${operation}`);
  };
  plugin.recreateDisposableCheckout = async (...args) => {
    recoveries.push(args);
    return "/sync/main";
  };
  return { plugin, calls, recoveries };
}

test("checkout equal to remote continues normally", async () => {
  const { plugin, calls, recoveries } = gitCheckoutFixture({ relation: "0 0" });
  assert.equal(await plugin.ensureGitCheckout("volnexx/obsidian-plugins", "centralize-plugins", "main"), "/sync/main");
  assert.equal(recoveries.length, 0);
  assert.equal(calls.some(call => call.args.includes("merge")), false);
});

test("checkout behind remote is updated by fast-forward", async () => {
  const { plugin, calls, recoveries } = gitCheckoutFixture({ relation: "0 2" });
  assert.equal(await plugin.ensureGitCheckout("volnexx/obsidian-plugins", "centralize-plugins", "main"), "/sync/main");
  assert.equal(recoveries.length, 0);
  assert.equal(calls.filter(call => call.args.join(" ") === "merge --ff-only origin/centralize-plugins").length, 1);
});

test("diverged local history stops without cleanup or history rewriting", async () => {
  const { plugin, calls, recoveries } = gitCheckoutFixture({ relation: "1 1" });
  await assert.rejects(
    plugin.ensureGitCheckout("volnexx/obsidian-plugins", "centralize-plugins", "main", { allowPendingPublish: true }),
    /уникальную локальную историю/u
  );
  assert.equal(recoveries.length, 0);
  const operations = calls.map(call => call.args.join(" "));
  assert.equal(operations.some(value => /(?:merge|rebase|push)/u.test(value)), false);
  assert.ok(operations.includes("fetch origin centralize-plugins"));
});

test("diverged checkout with unexpected uncommitted files stops without cleanup", async () => {
  const { plugin, calls, recoveries } = gitCheckoutFixture({ status: " M registry.json", relation: "1 1" });
  await assert.rejects(
    plugin.ensureGitCheckout("volnexx/obsidian-plugins", "centralize-plugins", "main"),
    /незавершённые изменения/u
  );
  assert.equal(recoveries.length, 0);
  assert.equal(calls.some(call => call.args[0] === "fetch"), false);
});

test("diverged checkout with unproven unique local commit stops", async () => {
  const { plugin, calls, recoveries } = gitCheckoutFixture({ relation: "1 1" });
  await assert.rejects(
    plugin.ensureGitCheckout("volnexx/obsidian-plugins", "centralize-plugins", "main"),
    /уникальную локальную историю/u
  );
  assert.equal(recoveries.length, 0);
  assert.equal(calls.some(call => /(?:merge|rebase|push)/u.test(call.args.join(" "))), false);
});

test("registry recovery proof accepts only local deltas already present on remote", () => {
  const base = { schemaVersion: 2, plugins: [{ id: "p", version: "1.0.0", sourceHash: "old" }] };
  const local = { schemaVersion: 2, plugins: [{ sourceHash: "new", version: "1.0.1", id: "p" }] };
  const remote = {
    schemaVersion: 2,
    plugins: [
      { id: "p", version: "1.0.1", sourceHash: "new" },
      { id: "other", version: "2.0.0" }
    ]
  };
  assert.equal(helpers.registryDeltaIsSubsumed(base, local, remote), true);
  assert.equal(helpers.registryDeltaIsSubsumed(base, local, { schemaVersion: 2, plugins: [{ id: "p", version: "1.0.1", sourceHash: "different" }] }), false);
});

function pendingProofFixture({ dirty = false, liveRemote = null, head = null, count = 1, tree = null, changedFiles = null, registryVersion = "1.1.0" } = {}) {
  const plugin = new UpdaterPlugin(appFixture());
  const base = "a".repeat(40);
  const pending = "b".repeat(40);
  const pendingTree = "c".repeat(40);
  const registryBlob = "d".repeat(40);
  const baseEntry = {
    id: "p", name: "Plugin P", version: "1.0.0", path: "p", sourcePath: "p/dev-source",
    sourceHash: "source-old", runtimeHash: "runtime-old", runtimeFiles: ["main.js", "manifest.json"],
    sourceComplete: true, isDesktopOnly: false, mobile: true
  };
  const pendingEntry = {
    id: "p", name: "Plugin P", version: registryVersion, path: "p", sourcePath: "p/dev-source",
    sourceHash: "source-new", runtimeHash: "runtime-new", runtimeFiles: ["main.js", "manifest.json"],
    sourceComplete: true, isDesktopOnly: false, mobile: true
  };
  plugin.node = { path: require("node:path"), crypto: require("node:crypto") };
  plugin.assertDisposableCheckoutIdentity = async () => {};
  plugin.gitHead = async () => head || pending;
  plugin.gitRemoteHead = async () => liveRemote || base;
  plugin.runDesktopProcess = async (_command, args) => {
    const operation = args.join(" ");
    if (operation === "status --porcelain") return { stdout: dirty ? " M registry.json" : "" };
    if (operation === "rev-parse HEAD^") return { stdout: base };
    if (operation === `rev-list --count ${base}..HEAD`) return { stdout: String(count) };
    throw new Error(`unexpected git operation: ${operation}`);
  };
  plugin.gitObjectSha = async (_checkout, _revision, file = "") => file === "registry.json" ? registryBlob : (tree || pendingTree);
  plugin.gitChangedPaths = async () => changedFiles || ["p/dev-source/main.js", "p/dev-source/manifest.json", "p/main.js", "p/manifest.json", "registry.json"].sort();
  plugin.readGitJson = async (_checkout, revision, file) => {
    if (file.endsWith("manifest.json") && file !== "registry.json") return { id: "p", name: "Plugin P", version: "1.1.0" };
    return revision === pending ? { schemaVersion: 2, plugins: [pendingEntry] } : { schemaVersion: 2, plugins: [baseEntry] };
  };
  plugin.hashProject = async () => "source-new";
  plugin.hashRuntime = async () => "runtime-new";
  plugin.gitTreeFiles = async () => ["main.js", "manifest.json"];
  plugin.gitBlobMap = async (_checkout, _revision, prefix) => prefix === "p/dev-source"
    ? { "main.js": "source-main", "manifest.json": "source-manifest" }
    : { "main.js": "runtime-main", "manifest.json": "runtime-manifest" };
  const transaction = {
    schemaVersion: 1, status: "pending", repository: "volnexx/obsidian-plugins",
    origin: "https://github.com/volnexx/obsidian-plugins.git", branch: "centralize-plugins",
    remoteBase: base, pendingCommit: pending, pendingTree, registryBlob,
    changedPaths: changedFiles || ["p/dev-source/main.js", "p/dev-source/manifest.json", "p/main.js", "p/manifest.json", "registry.json"].sort(),
    createdAt: "2026-08-29T00:00:00.000Z",
    plugins: [{
      id: "p", version: "1.1.0", path: "p", sourcePath: "p/dev-source",
      registryEntry: pendingEntry, registryEntryHash: plugin.hashJson(pendingEntry),
      sourceFiles: ["main.js", "manifest.json"], sourceHash: "source-new",
      runtimeFiles: ["main.js", "manifest.json"], runtimeHash: "runtime-new",
      sourceBlobs: { "main.js": "source-main", "manifest.json": "source-manifest" },
      runtimeBlobs: { "main.js": "runtime-main", "manifest.json": "runtime-manifest" }
    }]
  };
  return { plugin, transaction, base, pending, pendingTree };
}

test("journal pending resume is independent from newer canonical dev", async () => {
  const { plugin, transaction, pending } = pendingProofFixture();
  plugin.listDevProjects = async () => [{ id: "p", version: "1.4.0", dir: "/dev/p", manifest: { id: "p", version: "1.4.0" } }];
  const proof = await plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction);
  assert.equal(proof.commit, pending);
  assert.equal(proof.projects[0].version, "1.1.0");
});

test("dirty pending checkout stops", async () => {
  const { plugin, transaction } = pendingProofFixture({ dirty: true });
  await assert.rejects(
    plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction),
    /незавершённые изменения/u
  );
});

test("pending commit tree differing from journal stops", async () => {
  const { plugin, transaction } = pendingProofFixture({ tree: "e".repeat(40) });
  await assert.rejects(
    plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction),
    /HEAD\/parent\/tree/u
  );
});

test("pending commit with unknown changed file stops", async () => {
  const changedFiles = ["registry.json", "p/dev-source/main.js", "foreign.txt"].sort();
  const { plugin, transaction } = pendingProofFixture({ changedFiles });
  await assert.rejects(
    plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction),
    /неизвестные файлы/u
  );
});

test("journal base SHA differing from live remote stops", async () => {
  const { plugin, transaction } = pendingProofFixture({ liveRemote: "e".repeat(40) });
  await assert.rejects(plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction), /live remote/u);
});

test("journal pending SHA differing from checkout HEAD stops", async () => {
  const { plugin, transaction } = pendingProofFixture({ head: "e".repeat(40) });
  await assert.rejects(plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction), /HEAD\/parent\/tree/u);
});

test("extra local commit stops", async () => {
  const { plugin, transaction } = pendingProofFixture({ count: 2 });
  await assert.rejects(plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction), /HEAD\/parent\/tree/u);
});

test("registry entry differing from journal stops", async () => {
  const { plugin, transaction } = pendingProofFixture({ registryVersion: "1.1.1" });
  await assert.rejects(plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction), /registry (?:entry|metadata)/u);
});

test("crash after push recognizes pending commit already on live remote", async () => {
  const pending = "b".repeat(40);
  const { plugin, transaction } = pendingProofFixture({ liveRemote: pending });
  const proof = await plugin.proveJournalPendingPublish("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", transaction);
  assert.equal(proof.remoteAlreadyPublished, true);
});

test("crash immediately after commit finalizes preparing journal and resumes", async () => {
  const { plugin, transaction } = pendingProofFixture();
  const draft = {
    ...transaction,
    status: "preparing",
    pendingCommit: null,
    pendingTree: null,
    registryBlob: null,
    changedPaths: [],
    plugins: transaction.plugins.map(item => ({ ...item, sourceBlobs: null, runtimeBlobs: null }))
  };
  plugin.finalizePendingPublishJournal = async () => transaction;
  let persisted = null;
  plugin.writePendingPublishJournal = async value => { persisted = value; };
  const proof = await plugin.recoverCommittedPreparingTransaction("/checkout", "volnexx/obsidian-plugins", "centralize-plugins", draft);
  assert.equal(proof.recoveredAfterCommit, true);
  assert.equal(persisted.pendingCommit, transaction.pendingCommit);
});

test("remote changed concurrently after pending commit creation stops before push", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const calls = [];
  plugin.gitHead = async () => "pending";
  plugin.verifyRemoteHead = async (_checkout, _branch, expected) => {
    calls.push(`verify:${expected}`);
    throw new Error("Remote verification failed: concurrent update");
  };
  plugin.runDesktopProcess = async (_command, args) => { calls.push(args[0]); return { stdout: "" }; };
  await assert.rejects(plugin.pushAndVerify("/checkout", "centralize-plugins", "base"), /concurrent update/u);
  assert.deepEqual(calls, ["verify:base"]);
});

function stubDesktopSync(plugin, items) {
  plugin.isDesktopApp = true;
  plugin.node = { path: require("node:path") };
  plugin.settings = { registryBranch: "centralize-plugins" };
  plugin.ensureGitCheckout = async () => "/checkout";
  plugin.readPendingPublishJournal = async () => null;
  plugin.buildDesktopSyncPlan = async () => ({ registry: { plugins: [] }, items });
  plugin.readInstalledPlugins = async () => new Map();
  plugin.iphoneMirrorIsCurrent = async () => false;
  plugin.assertUpdateUnlocked = async () => true;
  plugin.createVaultBackup = async () => "/backup";
  plugin.readCheckoutRegistry = async () => ({ file: "/checkout/registry.json", registry: { schemaVersion: 2, plugins: [] } });
  plugin.gitHead = async () => "main-old";
  plugin.runDesktopProcess = async (_command, args) => {
    if (args.join(" ") === "rev-parse origin/centralize-plugins") return { stdout: "main-old" };
    throw new Error(`unexpected git operation: ${args.join(" ")}`);
  };
  plugin.verifyRemoteHead = async (_checkout, _branch, expected) => expected;
  plugin.writeDesktopJsonAtomic = async () => {};
  plugin.writePendingPublishJournal = async () => {};
  plugin.removePendingPublishJournal = async () => {};
  plugin.createCanonicalPublishDraft = async () => ({
    schemaVersion: 1, status: "preparing", remoteBase: "main-old",
    plugins: items.filter(item => item.decision === "dev-to-github").map(item => ({ id: item.project.id, registryEntry: { id: item.project.id, version: item.project.version, path: item.entry?.path || item.project.id } }))
  });
  plugin.finalizePendingPublishJournal = async (_checkout, draft, commit) => ({ ...draft, status: "pending", pendingCommit: commit });
  plugin.proveJournalPendingPublish = async (_checkout, _repo, branch, transaction) => ({
    checkout: "/checkout", branch, commit: transaction.pendingCommit, remoteBase: "main-old", transaction,
    projects: items.filter(item => item.decision === "dev-to-github").map(item => ({ ...item.project, transactionPlugin: { runtimeFiles: ["main.js", "manifest.json"], runtimeHash: "runtime" } }))
  });
  plugin.reconcilePendingRuntime = async pending => ({ updated: pending.projects.length, decisions: [] });
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
  const order = [];
  plugin.runProjectChecks = async () => { checks++; };
  plugin.readDesktopJson = async () => project.manifest;
  plugin.createCanonicalPublishDraft = async () => {
    order.push("snapshot");
    return {
      schemaVersion: 1, status: "preparing", remoteBase: "main-old",
      plugins: [{ id: "activity", registryEntry: { id: "activity", name: "Activity", version: "1.2.0", path: "activity", sourceComplete: true } }]
    };
  };
  plugin.writePendingPublishJournal = async transaction => { order.push(transaction.status === "pending" ? "journal-final" : "journal-draft"); };
  plugin.removePendingPublishJournal = async () => { order.push("journal-close"); };
  plugin.stageMainRepositoryPlugin = async () => {
    order.push("stage");
    staged++;
    return { id: "activity", name: "Activity", version: "1.2.0", path: "activity", sourceComplete: true };
  };
  plugin.listDevProjects = async () => [project];
  plugin.commitCheckout = async () => { order.push("commit"); return "main-new"; };
  plugin.pushAndVerify = async () => { order.push("push", "verify-remote"); return "main-new"; };
  plugin.reconcilePendingRuntime = async pending => { order.push("runtime"); runtime += pending.projects.length; return { updated: pending.projects.length, decisions: [] }; };
  plugin.rebuildIphoneMirror = async () => { mirror++; return { changed: true, count: 1, sha: "iphone-new" }; };
  const result = await plugin.safeDesktopSynchronizeAll();
  assert.equal(checks, 1);
  assert.equal(staged, 1);
  assert.equal(runtime, 1);
  assert.equal(mirror, 1);
  assert.equal(result.devToGithub, 1);
  assert.equal(result.mainSha, "main-new");
  assert.deepEqual(order, ["snapshot", "journal-draft", "stage", "commit", "journal-final", "push", "verify-remote", "runtime", "journal-close"]);
});

function outgoingFailureFixture() {
  const plugin = new UpdaterPlugin(appFixture());
  const project = { id: "p", version: "1.1.0", dir: "/dev/p", manifest: { id: "p", name: "P", version: "1.1.0" } };
  stubDesktopSync(plugin, [{ decision: "dev-to-github", project, entry: { id: "p", path: "p" } }]);
  plugin.runProjectChecks = async () => {};
  plugin.readDesktopJson = async () => project.manifest;
  plugin.createCanonicalPublishDraft = async () => ({ schemaVersion: 1, status: "preparing", remoteBase: "main-old", plugins: [{ id: "p", registryEntry: { id: "p", version: "1.1.0", path: "p" } }] });
  plugin.stageMainRepositoryPlugin = async () => ({ id: "p", version: "1.1.0", path: "p" });
  plugin.listDevProjects = async () => [project];
  plugin.rebuildIphoneMirror = async () => assert.fail("mirror must not run before confirmed main publish");
  return { plugin, project };
}

test("push failure leaves runtime unchanged", async () => {
  const { plugin } = outgoingFailureFixture();
  let runtime = 0;
  let removed = 0;
  const journalStates = [];
  plugin.writePendingPublishJournal = async transaction => { journalStates.push(transaction.status); };
  plugin.removePendingPublishJournal = async () => { removed++; };
  plugin.pushAndVerify = async () => { throw new Error("push failed"); };
  plugin.reconcilePendingRuntime = async () => { runtime++; return { updated: 1, decisions: [] }; };
  await assert.rejects(plugin.safeDesktopSynchronizeAll(), /push failed/u);
  assert.equal(runtime, 0);
  assert.deepEqual(journalStates, ["preparing", "pending"]);
  assert.equal(removed, 0);
});

test("successful push with failed remote verification leaves runtime unchanged", async () => {
  const { plugin } = outgoingFailureFixture();
  const order = [];
  let runtime = 0;
  let headCalls = 0;
  plugin.pushAndVerify = UpdaterPlugin.prototype.pushAndVerify.bind(plugin);
  plugin.gitHead = async () => ++headCalls < 3 ? "main-old" : "main-new";
  plugin.verifyRemoteHead = async (_checkout, _branch, expected) => {
    if (expected === "main-old") return expected;
    order.push("verify-remote-failed");
    throw new Error("remote verification failed");
  };
  plugin.runDesktopProcess = async (_command, args) => {
    const operation = args.join(" ");
    if (operation === "rev-parse origin/centralize-plugins") return { stdout: "main-old" };
    if (operation === "push origin HEAD:centralize-plugins") { order.push("push"); return { stdout: "" }; }
    throw new Error(`unexpected git operation: ${operation}`);
  };
  plugin.reconcilePendingRuntime = async () => { runtime++; return { updated: 1, decisions: [] }; };
  await assert.rejects(plugin.safeDesktopSynchronizeAll(), /remote verification failed/u);
  assert.deepEqual(order, ["push", "verify-remote-failed"]);
  assert.equal(runtime, 0);
});

test("pending 1.1 resumes once while canonical 1.4 waits for a second P", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const project = { id: "p", version: "1.1.0", dir: "/dev/p", manifest: { id: "p", name: "P", version: "1.1.0" } };
  const order = [];
  plugin.isDesktopApp = true;
  plugin.node = { path: require("node:path") };
  plugin.settings = { registryBranch: "centralize-plugins" };
  plugin.ensureGitCheckout = async () => "/checkout";
  plugin.readPendingPublishJournal = async () => ({ status: "pending" });
  plugin.gitHead = async () => "pending";
  plugin.runDesktopProcess = async (_command, args) => {
    if (args.join(" ") === "rev-parse origin/centralize-plugins") return { stdout: "base" };
    throw new Error(`unexpected git operation: ${args.join(" ")}`);
  };
  plugin.provePendingPublishCommit = async () => ({
    checkout: "/checkout", branch: "centralize-plugins", commit: "pending", remoteBase: "base", projects: [project], transaction: { status: "pending" }, remoteAlreadyPublished: false
  });
  plugin.assertUpdateUnlocked = async () => true;
  plugin.createVaultBackup = async () => "/backup";
  plugin.commitCheckout = async () => assert.fail("resume must not create a new commit");
  plugin.recreateDisposableCheckout = async () => assert.fail("resume must not delete or replace checkout");
  plugin.pushAndVerify = async (_checkout, _branch, base) => {
    assert.equal(base, "base");
    order.push("push-existing", "verify-remote");
    return "pending";
  };
  plugin.reconcilePendingRuntime = async pending => { order.push("runtime"); return { updated: pending.projects.length, decisions: [] }; };
  plugin.removePendingPublishJournal = async () => { order.push("close-journal"); };
  plugin.canonicalNewerThanPending = async () => [{ id: "p", pendingVersion: "1.1.0", canonicalVersion: "1.4.0" }];
  global.window = { location: { reload() {} }, setInterval: () => 1 };
  const result = await plugin.safeDesktopSynchronizeAll();
  assert.deepEqual(order, ["push-existing", "verify-remote", "runtime", "close-journal"]);
  assert.equal(result.resumedPending, true);
  assert.equal(result.mainSha, "pending");
  assert.equal(result.requiresAnotherPublish, true);
  assert.equal(result.newerCanonical[0].canonicalVersion, "1.4.0");
});

test("crash-after-push resume verifies remote and reconciles runtime without another push", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const project = { id: "p", version: "1.1.0", dir: "/checkout/p/dev-source", manifest: { id: "p", version: "1.1.0" } };
  plugin.assertUpdateUnlocked = async () => true;
  plugin.createVaultBackup = async () => "/backup";
  plugin.verifyRemoteHead = async (_checkout, _branch, expected) => expected;
  plugin.pushAndVerify = async () => assert.fail("already published transaction must not push again");
  plugin.reconcilePendingRuntime = async () => ({ updated: 1, decisions: [] });
  let removed = 0;
  plugin.removePendingPublishJournal = async () => { removed++; };
  plugin.canonicalNewerThanPending = async () => [];
  global.window = { location: { reload() {} } };
  const result = await plugin.resumePendingPublish({ checkout: "/checkout", branch: "centralize-plugins", commit: "pending", remoteBase: "base", projects: [project], transaction: {}, remoteAlreadyPublished: true });
  assert.equal(result.remoteAlreadyPublished, true);
  assert.equal(removed, 1);
});

function selfRecoveryRuntimeFixture({ localVersion = "1.4.0", localHash = "recovery-hash", canonicalVersion = "1.4.0", canonicalHash = "recovery-hash" } = {}) {
  const plugin = new UpdaterPlugin(appFixture());
  plugin.node = { path: require("node:path") };
  plugin.isDesktopApp = true;
  plugin.getDesktopVaultPath = () => "/vault";
  plugin.existingRuntimeFiles = async () => ["main.js", "manifest.json"];
  plugin.hashRuntime = async dir => dir === "/dev/updater-plugin" ? canonicalHash : localHash;
  plugin.listDevProjects = async () => [{ id: "updater-plugin", version: canonicalVersion, dir: "/dev/updater-plugin", manifest: { id: "updater-plugin", version: canonicalVersion } }];
  const project = {
    id: "updater-plugin", version: "1.1.0", dir: "/checkout/updater-plugin/dev-source",
    manifest: { id: "updater-plugin", version: "1.1.0" },
    transactionPlugin: { runtimeFiles: ["main.js", "manifest.json"], runtimeHash: "pending-hash" }
  };
  const installed = new Map([["updater-plugin", { id: "updater-plugin", version: localVersion, dir: ".obsidian/plugins/updater-plugin" }]]);
  return { plugin, project, installed };
}

test("newer byte-identical canonical self-updater recovery runtime is never downgraded", async () => {
  const { plugin, project, installed } = selfRecoveryRuntimeFixture();
  assert.equal(await plugin.pendingRuntimeDecision(project, installed), "keep-newer-self-recovery");
});

test("unknown newer self-updater runtime stops instead of trusting version alone", async () => {
  const { plugin, project, installed } = selfRecoveryRuntimeFixture({ localHash: "unknown-hash" });
  await assert.rejects(plugin.pendingRuntimeDecision(project, installed), /не совпадает с canonical recovery snapshot/u);
});

test("same-version different-hash pending runtime remains a conflict", async () => {
  const { plugin, project } = selfRecoveryRuntimeFixture({ localVersion: "1.1.0", localHash: "different" });
  const installed = new Map([["updater-plugin", { id: "updater-plugin", version: "1.1.0", dir: ".obsidian/plugins/updater-plugin" }]]);
  await assert.rejects(plugin.pendingRuntimeDecision(project, installed), /той же версии отличается/u);
});

test("exact legacy f717861 tuple can create only the narrow historical transaction", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  plugin.node = { path: require("node:path") };
  plugin.gitHead = async () => "f717861d425872785ab39350162d0bc114338dd3";
  plugin.gitRemoteHead = async () => "cd33c2a7acca60e4c3db2f070371e240297f70a1";
  plugin.gitObjectSha = async (_checkout, revision, file = "") => file === "registry.json"
    ? "967e5af4a22375d550af04a7e04ba2f178dfee85"
    : "d37a691aebd367c3a616d8e8137de091cb8804bb";
  plugin.runDesktopProcess = async (_command, args) => {
    if (args.join(" ") === "rev-parse HEAD^") return { stdout: "cd33c2a7acca60e4c3db2f070371e240297f70a1" };
    if (args.join(" ") === "rev-parse origin/centralize-plugins") return { stdout: "cd33c2a7acca60e4c3db2f070371e240297f70a1" };
    if (args.join(" ") === "rev-list --left-right --count HEAD...origin/centralize-plugins") return { stdout: "1 0" };
    if (args.join(" ") === "status --porcelain") return { stdout: "" };
    throw new Error(`unexpected: ${args.join(" ")}`);
  };
  const entry = { id: "updater-plugin", version: "0.11.2" };
  plugin.readGitJson = async () => ({ plugins: [entry] });
  plugin.createPendingPublishDraft = async () => ({ plugins: [], remoteBase: "cd33c2a7acca60e4c3db2f070371e240297f70a1" });
  plugin.finalizePendingPublishJournal = async () => ({
    schemaVersion: 1, status: "pending", plugins: [],
    changedPaths: [
      "registry.json", "updater-plugin/dev-source/main.js", "updater-plugin/dev-source/main.test.js",
      "updater-plugin/dev-source/manifest.json", "updater-plugin/main.js", "updater-plugin/manifest.json"
    ]
  });
  const transaction = await plugin.createLegacyPendingTransaction("/checkout", "volnexx/obsidian-plugins", "centralize-plugins");
  assert.equal(transaction.legacyRecovery, "f717861");
  plugin.gitHead = async () => "e".repeat(40);
  assert.equal(await plugin.createLegacyPendingTransaction("/checkout", "volnexx/obsidian-plugins", "centralize-plugins"), null);
});

test("normal push command contains no force option", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const calls = [];
  plugin.gitHead = async () => "b".repeat(40);
  plugin.verifyRemoteHead = async (_checkout, _branch, expected) => expected;
  plugin.runDesktopProcess = async (_command, args) => { calls.push(args); return { stdout: "" }; };
  await plugin.pushAndVerify("/checkout", "centralize-plugins", "a".repeat(40));
  const push = calls.find(args => args[0] === "push");
  assert.deepEqual(push, ["push", "origin", "HEAD:centralize-plugins"]);
});

test("unknown local commit ahead of origin stops without push, commit or cleanup", async () => {
  const plugin = new UpdaterPlugin(appFixture());
  const actions = [];
  plugin.isDesktopApp = true;
  plugin.node = { path: require("node:path") };
  plugin.settings = { registryBranch: "centralize-plugins" };
  plugin.ensureGitCheckout = async () => "/checkout";
  plugin.readPendingPublishJournal = async () => null;
  plugin.gitHead = async () => "unknown";
  plugin.runDesktopProcess = async () => ({ stdout: "base" });
  plugin.provePendingPublishCommit = async () => { throw new Error("unknown local history"); };
  plugin.pushAndVerify = async () => { actions.push("push"); };
  plugin.commitCheckout = async () => { actions.push("commit"); };
  plugin.recreateDisposableCheckout = async () => { actions.push("cleanup"); };
  await assert.rejects(plugin.safeDesktopSynchronizeAll(), /unknown local history/u);
  assert.deepEqual(actions, []);
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
  plugin.readPendingPublishJournal = async () => null;
  let checks = 0;
  let backups = 0;
  plugin.assertUpdateUnlocked = async () => ++checks === 1;
  plugin.ensureGitCheckout = async () => "/checkout";
  plugin.gitHead = async () => "base";
  plugin.runDesktopProcess = async () => ({ stdout: "base" });
  plugin.verifyRemoteHead = async () => "base";
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
