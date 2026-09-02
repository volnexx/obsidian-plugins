"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(); this.attributeOrder = []; this.children = []; this.listeners = new Map();
    this.classes = new Set(); this.parentElement = null; this.isConnected = false; this.sent = []; this.actions = [];
    this.classList = { add: (x) => this.classes.add(x), remove: (x) => this.classes.delete(x), contains: (x) => this.classes.has(x) };
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); this.attributeOrder.push(k); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  hasAttribute(k) { return this.attributes.has(k); }
  addEventListener(k, fn) { if (!this.listeners.has(k)) this.listeners.set(k, new Set()); this.listeners.get(k).add(fn); }
  removeEventListener(k, fn) { this.listeners.get(k)?.delete(fn); }
  emit(k, ...args) { for (const fn of [...(this.listeners.get(k) || [])]) fn(...args); }
  listenerCount(k) { return this.listeners.get(k)?.size || 0; }
  appendChild(child) { child.parentElement = this; child.isConnected = true; this.children.push(child); return child; }
  replaceChildren() { for (const c of this.children) { c.parentElement = null; c.isConnected = false; } this.children = []; }
  empty() { this.replaceChildren(); }
  addClass(x) { this.classes.add(x); } removeClass(x) { this.classes.delete(x); }
  remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; this.isConnected = false; }
  send(channel, payload) { this.sent.push({ channel, payload }); }
  loadURL(url) { this.loadedUrl = url; this.setAttribute("src", url); }
  canGoBack() { return this.backAvailable === true; } canGoForward() { return this.forwardAvailable === true; }
  goBack() { this.backCalls = (this.backCalls || 0) + 1; } goForward() { this.forwardCalls = (this.forwardCalls || 0) + 1; }
  reload() { this.reloadCalls = (this.reloadCalls || 0) + 1; }
}

class FakeItemView {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = leaf.contentEl || new FakeElement(); this.baseStates = []; }
  async setState(state, result) { this.baseStates.push({ state, result }); }
  addAction(icon, title, callback) { const action = new FakeElement("button"); action.icon = icon; action.title = title; action.callback = callback; this.actions ||= []; this.actions.push(action); return action; }
}

class FakePlugin {
  constructor(app) {
    this.app = app; this.manifest = { id: "gpt-obsidian", version: "2.1.0", dir: __dirname };
    this.registeredViews = new Map(); this.commands = []; this.ribbons = []; this.intervals = [];
  }
  registerView(type, factory) { this.registeredViews.set(type, factory); }
  addCommand(command) { this.commands.push(command); }
  addRibbonIcon(icon, title, callback) { this.ribbons.push({ icon, title, callback }); }
  registerInterval(id) { this.intervals.push(id); }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return { ItemView: FakeItemView, Notice: class Notice {}, Plugin: FakePlugin };
  if (request === "electron") return { shell: { openExternal() {} } };
  return originalLoad.call(this, request, parent, isMain);
};

let timerSerial = 0;
const timers = new Map();
global.window = {
  setInterval(fn) { const id = ++timerSerial; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); },
  setTimeout(fn) { const id = ++timerSerial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }
};
global.document = { createElement: (tag) => new FakeElement(tag) };
Object.defineProperty(global, "navigator", {
  configurable: true,
  value: { clipboard: { async writeText(text) { global.__copied = text; } } }
});

const manifest = require("./manifest.json");
const Plugin = require("./main.js");
const { GPTObsidianView, _test: t } = Plugin;

function makeManager(backendId = "backend-1") {
  const session = { id: "agent-1", getStatus: () => "active", getBackendSessionId: () => backendId };
  return {
    session, resolver: null, registered: 0, unregistered: 0, subscribed: 0,
    getActiveSession() { return this.session; },
    registerExternalPermissionResolver(fn) { this.registered += 1; this.resolver = fn; return () => { this.unregistered += 1; if (this.resolver === fn) this.resolver = null; }; },
    subscribe(fn) { this.subscription = fn; this.subscribed += 1; return () => { this.subscription = null; }; }
  };
}

function makeApp(manager = null) {
  let app;
  const workspace = {
    leaves: [], revealed: [], detached: [], saves: 0, active: null,
    getLeaf(mode) { const leaf = { app, mode, async setViewState(state) { this.state = state; } }; this.leaves.push(leaf); return leaf; },
    async revealLeaf(leaf) { this.revealed.push(leaf); }, detachLeavesOfType(type) { this.detached.push(type); },
    requestSaveLayout() { this.saves += 1; }, getActiveViewOfType() { return this.active; }
  };
  const calls = [];
  app = {
    workspace,
    commands: { commands: { "workspace:next-tab": {}, "workspace:previous-tab": {} }, executeCommandById(id) { calls.push(id); return true; } },
    hotkeyManager: { defaultKeys: {
      "workspace:next-tab": [{ modifiers: ["Mod", "Shift"], key: "]" }],
      "workspace:previous-tab": [{ modifiers: ["Mod", "Shift"], key: "[" }]
    }, customKeys: {} },
    plugins: { plugins: manager ? { copilot: { agentSessionManager: manager } } : {} }, calls
  };
  return app;
}

async function makePlugin(app = makeApp()) { const plugin = new Plugin(app); await plugin.onload(); return plugin; }
async function openView(plugin, url = null) {
  const leaf = { app: plugin.app, contentEl: new FakeElement(), headerUpdates: 0, updateHeader() { this.headerUpdates += 1; } };
  const view = new GPTObsidianView(leaf, plugin);
  if (url) await view.setState({ url }, {});
  await view.onOpen();
  return { leaf, view, webview: view.webview, host: leaf.contentEl };
}
function ready(view) { view.webview.emit("ipc-message", { channel: t.CHANNELS.READY, args: [{ version: 1 }] }); }
function permissionRequest(overrides = {}) {
  return { sessionId: "backend-1", toolCall: { toolCallId: "request-1", kind: "shell", title: "List files", rawInput: { command: "ls" } },
    options: [{ optionId: "opaque-once", name: "Allow once" }, { optionId: "opaque-session", name: "Allow for this session" }, { optionId: "opaque-always", name: "Allow always" }, { optionId: "opaque-reject", name: "Reject" }], ...overrides };
}

test("A manifest/view: 2.1.0 desktop identity", () => {
  assert.deepEqual([manifest.id, manifest.name, manifest.version, manifest.isDesktopOnly], ["gpt-obsidian", "GPT Obsidian", "2.1.0", true]);
});

test("A manifest/view: registers ItemView, useful commands, and ribbon", async () => {
  const plugin = await makePlugin();
  assert.equal(typeof plugin.registeredViews.get(t.VIEW_TYPE), "function");
  assert.deepEqual(plugin.commands.map((c) => c.id), ["open-new-chatgpt-tab", "open-chatgpt-home", "reload-current-gpt", "focus-chatgpt-prompt", "toggle-copilot-bridge", "copy-diagnostics"]);
  assert.equal(plugin.ribbons.length, 1);
  plugin.onunload();
});

test("A manifest/view: open command creates a new tab leaf", async () => {
  const plugin = await makePlugin(); await plugin.openNewChatGptTab();
  assert.deepEqual(plugin.app.workspace.leaves[0].state, { type: t.VIEW_TYPE, active: true, state: { url: t.DEFAULT_CHATGPT_URL } });
  assert.equal(plugin.app.workspace.revealed.length, 1); plugin.onunload();
});

test("A manifest/view: two views are isolated", async () => {
  const plugin = await makePlugin(); const a = await openView(plugin); const b = await openView(plugin);
  assert.notEqual(a.webview, b.webview); assert.equal(a.webview.getAttribute("partition"), b.webview.getAttribute("partition"));
  await a.view.onClose(); assert.equal(b.webview.isConnected, true); assert.equal(b.view.webview, b.webview); await b.view.onClose(); plugin.onunload();
});

test("B webview: owned persistent secure preload precedes navigation", async () => {
  const plugin = await makePlugin(); const { view, webview, host } = await openView(plugin);
  assert.equal(host.children.length, 1); assert.equal(webview.getAttribute(t.OWNER_ATTRIBUTE), "true");
  assert.equal(webview.getAttribute("partition"), t.CHATGPT_PARTITION); assert.match(webview.getAttribute("preload"), /^file:/u);
  assert.equal(webview.getAttribute("webpreferences"), t.SECURE_WEB_PREFERENCES);
  assert.ok(webview.attributeOrder.indexOf("preload") < webview.attributeOrder.indexOf("src"));
  for (const unsafe of ["nodeintegration", "allowpopups", "disablewebsecurity"]) assert.equal(webview.hasAttribute(unsafe), false);
  await view.onClose(); plugin.onunload();
});

test("B webview: embedded preload integrity matches the plugin-owned file", () => {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "preload.js"))).digest("hex");
  assert.equal(digest, t.PRELOAD_SHA256);
});

test("B webview: missing or damaged runtime preload is atomically self-provisioned", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-obsidian-preload-"));
  try {
    const destination = t.ensurePreloadFile(temporary);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex"), t.PRELOAD_SHA256);
    fs.writeFileSync(destination, "damaged"); t.ensurePreloadFile(temporary);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex"), t.PRELOAD_SHA256);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("B webview: URL state round-trip, title text, and restore", async () => {
  const plugin = await makePlugin(); const url = "https://chatgpt.com/c/example"; const { view, webview, leaf } = await openView(plugin, url);
  assert.equal(webview.getAttribute("src"), url); webview.emit("did-navigate-in-page", { url: `${url}-2` });
  assert.deepEqual(view.getState(), { url: `${url}-2` }); assert.equal(plugin.app.workspace.saves, 1);
  webview.emit("page-title-updated", { title: "Conversation <b>x</b> — ChatGPT" });
  assert.equal(view.getDisplayText(), "Conversation <b>x</b>"); assert.equal(leaf.headerUpdates, 1);
  await view.onClose(); plugin.onunload();
});

test("B webview: navigation actions and popup policy are view-local", async () => {
  const plugin = await makePlugin(); const { view, webview } = await openView(plugin);
  webview.backAvailable = webview.forwardAvailable = true; view.goBack(); view.goForward(); view.reload();
  assert.deepEqual([webview.backCalls, webview.forwardCalls, webview.reloadCalls], [1, 1, 1]);
  let prevented = 0; webview.emit("new-window", { url: "https://chatgpt.com/c/new", preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1); assert.equal(webview.loadedUrl, "https://chatgpt.com/c/new");
  await view.onClose(); plugin.onunload();
});

test("B webview: close removes every local listener", async () => {
  const plugin = await makePlugin(); const { view, webview } = await openView(plugin); const names = [...webview.listeners.keys()];
  await view.onClose(); for (const name of names) assert.equal(webview.listenerCount(name), 0); plugin.onunload();
});

test("B focus: failed autofocus result schedules only the next bounded attempt", async () => {
  const plugin = await makePlugin(); const { view } = await openView(plugin);
  plugin.focusViewPrompt(view, 0); const requestId = view.focusRequest.requestId;
  plugin.handleGuestMessage(view, { channel: t.CHANNELS.FOCUS_RESULT, args: [{ version: 1, requestId, focused: false }] });
  assert.notEqual(view.focusTimer, null); const timer = view.focusTimer; timers.get(timer)();
  assert.equal(view.focusRequest.autoAttempt, 1); await view.onClose(); plugin.onunload();
});

test("C keyboard: allowlist uses defaults, custom overrides, modifiers, and opaque token", () => {
  const app = makeApp(); let list = t.buildHotkeyAllowlist(app, 7);
  assert.deepEqual(list[0], { token: "7:workspace:next-tab", commandId: "workspace:next-tab", key: "]", ctrl: true, meta: false, alt: false, shift: true });
  app.hotkeyManager.customKeys["workspace:next-tab"] = []; list = t.buildHotkeyAllowlist(app, 8);
  assert.equal(list.some((x) => x.commandId === "workspace:next-tab"), false);
});

test("C keyboard: ordinary Enter, arrows, and text bindings never enter the global allowlist", () => {
  const app = makeApp();
  app.commands.commands = { enter: {}, arrow: {}, text: {}, escape: {} };
  app.hotkeyManager.defaultKeys = {
    enter: [{ modifiers: [], key: "Enter" }], arrow: [{ modifiers: ["Shift"], key: "ArrowLeft" }],
    text: [{ modifiers: [], key: "a" }], escape: [{ modifiers: [], key: "Escape" }]
  };
  assert.deepEqual(t.buildHotkeyAllowlist(app, 1).map((x) => x.commandId), ["escape"]);
});

test("C keyboard: one focused-view IPC event dispatches exactly once", async () => {
  const plugin = await makePlugin(); const { view } = await openView(plugin); ready(view); view.focused = true; plugin.app.workspace.active = view;
  const token = plugin.hotkeyPayload[0].token; plugin.handleGuestMessage(view, { channel: t.CHANNELS.KEYBOARD, args: [{ version: 1, token }] });
  assert.deepEqual(plugin.app.calls, ["workspace:next-tab"]); await view.onClose(); plugin.onunload();
});

test("C keyboard: two views never double-dispatch and closed view cannot dispatch", async () => {
  const plugin = await makePlugin(); const a = await openView(plugin); const b = await openView(plugin); ready(a.view); ready(b.view);
  const token = plugin.hotkeyPayload[0].token; a.view.focused = true; b.view.focused = true; plugin.app.workspace.active = b.view;
  plugin.handleKeyboardMessage(a.view, { version: 1, token }); plugin.handleKeyboardMessage(b.view, { version: 1, token });
  assert.equal(plugin.app.calls.length, 1); await b.view.onClose(); plugin.handleKeyboardMessage(b.view, { version: 1, token });
  assert.equal(plugin.app.calls.length, 1); await a.view.onClose(); plugin.onunload();
});

test("C keyboard: preload ready reuses one listener and refreshes hotkeys without reattach", async () => {
  const plugin = await makePlugin(); const { view, webview } = await openView(plugin); const count = webview.listenerCount("ipc-message");
  ready(view); ready(view); assert.equal(webview.listenerCount("ipc-message"), count); assert.ok(webview.sent.filter((x) => x.channel === t.CHANNELS.CONFIG).length >= 2);
  await view.onClose(); plugin.onunload();
});

test("D permission: old/new option meanings use human labels, not opaque IDs", () => {
  assert.equal(t.permissionMeaning({ optionId: "allow-always-looking-token", name: "Allow once" }), "once");
  assert.equal(t.permissionMeaning({ name: "Разрешить на сессию" }), "session");
  assert.equal(t.permissionMeaning({ name: "Allow and don't ask again" }), "permanent");
});

test("D permission: strict nonce parser and native-only safety", () => {
  const request = permissionRequest(); const text = `<GPT_COPILOT_CONTROL version="1">\nrequestId: request-1\ncorrelationNonce: n\naction: permission_decision\noptionId: opaque-once\n</GPT_COPILOT_CONTROL>`;
  assert.equal(t.parsePermissionDecision(text, request, "n"), "opaque-once"); assert.equal(t.parsePermissionDecision(text, request, "wrong"), null);
  assert.equal(t.requestNeedsNativeUi(permissionRequest({ toolCall: { toolCallId: "request-1", kind: "shell", title: "delete", rawInput: { command: "rm -rf /tmp/x" } } })), true);
  assert.equal(t.requestNeedsNativeUi(permissionRequest({ toolCall: { toolCallId: "request-1", kind: "shell", title: "simple tmp", rawInput: { command: "rm /tmp/x" } } })), false);
  assert.equal(t.requestNeedsNativeUi(permissionRequest({ toolCall: { toolCallId: "request-1", kind: "shell", title: "chain", rawInput: { command: "pwd && ls" } } })), false);
});

test("D permission: preferred focused view is sole owner and close transfers ownership", async () => {
  const manager = makeManager(); const plugin = await makePlugin(makeApp(manager)); const a = await openView(plugin); const b = await openView(plugin);
  a.view.bridge.enabled = true; b.view.bridge.enabled = true; plugin.markPreferredView(a.view);
  assert.equal(plugin.sessionOwners.get("backend-1"), a.view); plugin.markPreferredView(b.view);
  assert.equal(plugin.sessionOwners.get("backend-1"), b.view); assert.equal(a.view.bridge.state, t.BRIDGE_STATES.STANDBY);
  await b.view.onClose(); assert.equal(plugin.sessionOwners.get("backend-1"), a.view); await a.view.onClose(); plugin.onunload();
});

test("D permission: delayed/replaced backend deterministically rebinds", async () => {
  const manager = makeManager(null); const plugin = await makePlugin(makeApp(manager)); const item = await openView(plugin); item.view.bridge.enabled = true; plugin.reconcileBridge();
  assert.equal(item.view.bridge.state, t.BRIDGE_STATES.WAITING_BACKEND); manager.session.getBackendSessionId = () => "backend-2"; plugin.reconcileBridge();
  assert.equal(item.view.bridge.state, t.BRIDGE_STATES.CONNECTED); assert.equal(item.view.bridge.sessionId, "backend-2");
  manager.session.getBackendSessionId = () => "backend-3"; plugin.reconcileBridge(); assert.equal(item.view.bridge.sessionId, "backend-3");
  await item.view.onClose(); plugin.onunload();
});

test("D permission: closed Agent reports waiting for Agent rather than backend", async () => {
  const manager = makeManager(); manager.session.getStatus = () => "closed";
  const plugin = await makePlugin(makeApp(manager)); const item = await openView(plugin); item.view.bridge.enabled = true; plugin.reconcileBridge();
  assert.equal(item.view.bridge.state, t.BRIDGE_STATES.WAITING_AGENT); await item.view.onClose(); plugin.onunload();
});

test("D permission: one request resolves once with native schema and deduplicates", async () => {
  const manager = makeManager(); const plugin = await makePlugin(makeApp(manager)); const item = await openView(plugin); ready(item.view);
  item.view.bridge.enabled = true; plugin.markPreferredView(item.view); const request = permissionRequest();
  const first = plugin.resolvePermission(request); const second = plugin.resolvePermission(request); const pending = plugin.pendingRequests.get("request-1");
  const text = `<GPT_COPILOT_CONTROL version="1">\nrequestId: request-1\ncorrelationNonce: ${pending.nonce}\naction: permission_decision\noptionId: opaque-once\n</GPT_COPILOT_CONTROL>`;
  plugin.handleBridgeResponse(item.view, { version: 1, requestId: "request-1", text }); plugin.handleBridgeResponse(item.view, { version: 1, requestId: "request-1", text });
  assert.deepEqual(await first, { outcome: { outcome: "selected", optionId: "opaque-once" } }); assert.deepEqual(await second, await first);
  assert.equal(item.webview.sent.filter((x) => x.channel === t.CHANNELS.BRIDGE_REQUEST).length, 1);
  await item.view.onClose(); plugin.onunload();
});

test("D permission: permanent and destructive decisions fall back to native UI", async () => {
  const manager = makeManager(); const plugin = await makePlugin(makeApp(manager)); const item = await openView(plugin); ready(item.view); item.view.bridge.enabled = true; plugin.markPreferredView(item.view);
  assert.equal(await plugin.resolvePermission(permissionRequest({ toolCall: { toolCallId: "native", kind: "delete", title: "delete", rawInput: {} } })), null);
  const promise = plugin.resolvePermission(permissionRequest()); const pending = plugin.pendingRequests.get("request-1");
  const text = `<GPT_COPILOT_CONTROL version="1">\nrequestId: request-1\ncorrelationNonce: ${pending.nonce}\naction: permission_decision\noptionId: opaque-always\n</GPT_COPILOT_CONTROL>`;
  plugin.handleBridgeResponse(item.view, { version: 1, requestId: "request-1", text }); assert.equal(await promise, null);
  await item.view.onClose(); plugin.onunload();
});

test("D permission: bridge error and timeout each settle a request at most once", async () => {
  const manager = makeManager(); const plugin = await makePlugin(makeApp(manager)); const item = await openView(plugin); ready(item.view); item.view.bridge.enabled = true; plugin.markPreferredView(item.view);
  const failed = plugin.resolvePermission(permissionRequest()); const firstPending = plugin.pendingRequests.get("request-1");
  plugin.handleBridgeError(item.view, { requestId: "request-1", error: "guest busy" }); plugin.handleBridgeError(item.view, { requestId: "request-1", error: "again" });
  assert.equal(await failed, null); assert.equal(firstPending.settled, true);
  const timedRequest = permissionRequest({ toolCall: { toolCallId: "request-2", kind: "shell", title: "List", rawInput: { command: "ls" } } });
  const timed = plugin.resolvePermission(timedRequest); const secondPending = plugin.pendingRequests.get("request-2"); timers.get(secondPending.timer)();
  assert.equal(await timed, null); assert.equal(plugin.pendingRequests.size, 0); await item.view.onClose(); plugin.onunload();
});

test("D permission: fallback permissionPrompter cleanup is identity-safe", async () => {
  const original = async () => ({ native: true }); const manager = { opts: { permissionPrompter: original }, wirePrompters() { this.wires = (this.wires || 0) + 1; }, getActiveSession: () => null };
  const plugin = await makePlugin(makeApp(manager)); const wrapper = manager.opts.permissionPrompter; assert.notEqual(wrapper, original);
  const alien = async () => ({ alien: true }); manager.opts.permissionPrompter = alien; plugin.detachCopilotManager(); assert.equal(manager.opts.permissionPrompter, alien); plugin.onunload();
});

test("D permission: fallback wires future backends and restores only its own handler", async () => {
  const original = async () => ({ native: true });
  const manager = { opts: { permissionPrompter: original }, backends: new Map(), getActiveSession: () => null,
    wirePrompters(backend) { backend.setPermissionPrompter(this.opts.permissionPrompter); } };
  const plugin = await makePlugin(makeApp(manager));
  const backend = { permissionPrompter: original, setPermissionPrompter(fn) { this.permissionPrompter = fn; } };
  manager.wirePrompters(backend); assert.notEqual(backend.permissionPrompter, original);
  plugin.detachCopilotManager(); assert.equal(backend.permissionPrompter, original); plugin.onunload();
});

test("E lifecycle: crash releases ownership/pending and reload remains available", async () => {
  const manager = makeManager(); const plugin = await makePlugin(makeApp(manager)); const item = await openView(plugin); ready(item.view); item.view.bridge.enabled = true; plugin.markPreferredView(item.view);
  item.webview.emit("render-process-gone", {}, { reason: "crashed" }); plugin.reconcileBridge();
  assert.equal(item.view.crashed, true); assert.equal(plugin.sessionOwners.size, 0); assert.equal(item.view.bridge.state, t.BRIDGE_STATES.RECONNECTING);
  item.view.reload(); assert.equal(item.webview.reloadCalls, 1); await item.view.onClose(); plugin.onunload();
});

test("E lifecycle: unload restores resolver/subscription and detaches only native type", async () => {
  const manager = makeManager(); const plugin = await makePlugin(makeApp(manager)); await openView(plugin); plugin.onunload();
  assert.equal(manager.unregistered, 1); assert.equal(manager.subscription, null); assert.deepEqual(plugin.app.workspace.detached, [t.VIEW_TYPE]); assert.equal(plugin.views.size, 0);
});

test("E lifecycle: disable then re-enable creates no duplicate Copilot resolver", async () => {
  const manager = makeManager(); const app = makeApp(manager); const first = await makePlugin(app); first.onunload();
  const second = await makePlugin(app); assert.equal(manager.registered, 2); assert.equal(manager.unregistered, 1); assert.equal(typeof manager.resolver, "function");
  second.onunload(); assert.equal(manager.unregistered, 2); assert.equal(manager.resolver, null);
});

test("F diagnostics: accurate snapshot fingerprints session and excludes secrets", async () => {
  const manager = makeManager("backend-secret-value"); const plugin = await makePlugin(makeApp(manager)); const item = await openView(plugin); ready(item.view); item.view.bridge.enabled = true; plugin.markPreferredView(item.view);
  const json = JSON.stringify(plugin.diagnostics()); assert.match(json, /backendSessionFingerprint/u); assert.doesNotMatch(json, /backend-secret-value/u); assert.doesNotMatch(json, /cookie|authorization/iu);
  await item.view.onClose(); plugin.onunload();
});

test("G donor regressions: native source has no old global/Web Viewer mechanisms", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  for (const forbidden of [/collectChatGptWebviews/iu, /iterateAllLeaves/iu, /before-input-event/iu, /prependListener/iu, /removeAllListeners/iu, /queueMicrotask/iu, /app\.keymap/iu, /executeCommandById\s*=/iu, /MutationObserver/iu, /allowpopups/iu, /webSecurity\s*:\s*false/iu]) assert.doesNotMatch(source, forbidden);
});

test("G donor regressions: Browser donor explicitly ignores native owner marker", () => {
  const donor = fs.readFileSync(path.join(__dirname, "..", "browser-gpt-obsidian", "main.js"), "utf8");
  assert.match(donor, /data-gpt-obsidian-owned/iu); assert.match(donor, /isNativeGptOwnedWebview/iu);
});

test("G release gate: standalone preload/keyboard suite passes", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "preload.test.js")], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
