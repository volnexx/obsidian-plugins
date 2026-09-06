"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(); this.attributeOrder = []; this.children = []; this.listeners = new Map();
    this.classes = new Set(); this.parentElement = null; this.isConnected = false; this.sent = []; this.actions = [];
    this.style = {};
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
  focus() { this.focusCalls = (this.focusCalls || 0) + 1; this.emit("focus"); }
}

class FakeItemView {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = leaf.contentEl || new FakeElement(); this.baseStates = []; }
  async setState(state, result) { this.baseStates.push({ state, result }); }
  addAction(icon, title, callback) { const action = new FakeElement("button"); action.icon = icon; action.title = title; action.callback = callback; this.actions ||= []; this.actions.push(action); return action; }
}

class FakePlugin {
  constructor(app) {
    this.app = app; this.manifest = { id: "gpt-obsidian", version: "2.2.2", dir: __dirname };
    this.registeredViews = new Map(); this.commands = []; this.ribbons = []; this.intervals = []; this.events = [];
  }
  registerView(type, factory) { this.registeredViews.set(type, factory); }
  addCommand(command) { this.commands.push(command); }
  addRibbonIcon(icon, title, callback) { this.ribbons.push({ icon, title, callback }); }
  registerInterval(id) { this.intervals.push(id); }
  registerEvent(ref) { this.events.push(ref); }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return { ItemView: FakeItemView, Notice: class Notice {}, Plugin: FakePlugin, setIcon(el, icon) { el.icon = icon; } };
  if (request === "electron") return { shell: { openExternal() {} } };
  return originalLoad.call(this, request, parent, isMain);
};

let timerSerial = 0;
const timers = new Map();
global.window = {
  setInterval(fn) { const id = ++timerSerial; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); },
  setTimeout(fn) { const id = ++timerSerial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  getComputedStyle(target) { return { color: target?.style?.color || "rgb(238, 238, 238)", getPropertyValue(name) { return name === "--interactive-accent" ? "rgb(10, 20, 30)" : name === "--text-normal" ? "rgb(238, 238, 238)" : ""; } }; }
};
global.document = { createElement: (tag) => new FakeElement(tag), body: new FakeElement("body"), documentElement: new FakeElement("html") };
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
    leaves: [], revealed: [], detached: [], saves: 0, active: null, events: new Map(),
    getLeaf(mode) { const leaf = { app, mode, async setViewState(state) { this.state = state; } }; this.leaves.push(leaf); return leaf; },
    async revealLeaf(leaf) { this.revealed.push(leaf); }, detachLeavesOfType(type) { this.detached.push(type); },
    requestSaveLayout() { this.saves += 1; }, getActiveViewOfType() { return this.active; },
    on(name, callback) { const ref = { name, callback }; if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(ref); return ref; },
    offref(ref) { this.events.get(ref?.name)?.delete(ref); }, emit(name, value) { for (const ref of this.events.get(name) || []) ref.callback(value); }
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

test("A manifest/view: 2.2.2 desktop identity", () => {
  assert.deepEqual([manifest.id, manifest.name, manifest.version, manifest.isDesktopOnly], ["gpt-obsidian", "GPT Obsidian", "2.2.2", true]);
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
  assert.equal(host.children.length, 2); assert.equal(host.children[0], view.toolbarEl); assert.equal(host.children[1], webview);
  assert.equal(webview.getAttribute(t.OWNER_ATTRIBUTE), "true");
  assert.equal(webview.getAttribute("partition"), t.CHATGPT_PARTITION); assert.match(webview.getAttribute("preload"), /^file:/u);
  assert.equal(webview.getAttribute("webpreferences"), t.SECURE_WEB_PREFERENCES);
  assert.ok(webview.attributeOrder.indexOf("preload") < webview.attributeOrder.indexOf("src"));
  for (const unsafe of ["nodeintegration", "allowpopups", "disablewebsecurity"]) assert.equal(webview.hasAttribute(unsafe), false);
  await view.onClose(); plugin.onunload();
});

test("B toolbar: five view-local controls remain inside content when Obsidian header is hidden", async () => {
  const plugin = await makePlugin(); const item = await openView(plugin);
  assert.equal(item.view.toolbarEl.parentElement, item.host); assert.equal(item.view.toolbarEl.children.length, 5);
  item.webview.backAvailable = item.webview.forwardAvailable = true;
  item.view.backAction.emit("click"); item.view.forwardAction.emit("click"); item.view.reloadAction.emit("click"); item.view.focusAction.emit("click");
  assert.deepEqual([item.webview.backCalls, item.webview.forwardCalls, item.webview.reloadCalls], [1, 1, 1]);
  assert.equal(item.webview.sent.at(-1).channel, t.CHANNELS.FOCUS);
  await item.view.onClose(); assert.equal(item.view.toolbarEl, null); plugin.onunload();
});

test("B webview: embedded preload integrity matches the plugin-owned file", () => {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "preload.js"))).digest("hex");
  assert.equal(digest, t.PRELOAD_SHA256);
});

test("B production preload integration: sandbox source without CommonJS sends READY and connects host view", async () => {
  const source = fs.readFileSync(path.join(__dirname, "preload.js"), "utf8");
  const guestMessages = []; const hostListeners = new Map(); const windowListeners = new Map();
  const sandbox = {
    console, TextEncoder, URL, DOMException,
    location: { hostname: "chatgpt.com" }, navigator: { clipboard: { async writeText() {} } },
    window: { addEventListener(name, callback) { windowListeners.set(name, callback); }, setTimeout, clearTimeout, setInterval, clearInterval,
      getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
    document: { readyState: "loading", querySelectorAll: () => [], getElementById: () => null, createElement: () => ({}),
      head: { appendChild() {} }, documentElement: { appendChild() {} } },
    require(id) {
      if (id !== "electron") throw new Error(`sandbox preload cannot require ${id}`);
      return {
        ipcRenderer: { sendToHost(channel, payload) { guestMessages.push({ channel, payload }); }, on(channel, callback) { hostListeners.set(channel, callback); } },
        contextBridge: { exposeInMainWorld() {}, executeInMainWorld() { return false; } }
      };
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "production-preload.js" });
  const readyMessage = guestMessages.find((message) => message.channel === t.CHANNELS.READY);
  assert.equal(readyMessage?.payload?.version, 1); assert.equal(readyMessage?.payload?.ok, true);
  assert.equal(windowListeners.has("keydown"), true); assert.equal(hostListeners.has(t.CHANNELS.CONFIG), true);
  const plugin = await makePlugin(); const item = await openView(plugin);
  assert.equal(item.view.preloadConnected, false);
  plugin.handleGuestMessage(item.view, { channel: readyMessage.channel, args: [readyMessage.payload] });
  assert.equal(item.view.preloadConnected, true); assert.equal(item.view.preloadStatus, "ready");
  await item.view.onClose(); plugin.onunload();
});

test("B/C live regression: real CONFIG/APPEARANCE/keydown cross preload-host boundary with ACK diagnostics", async () => {
  const source = fs.readFileSync(path.join(__dirname, "preload.js"), "utf8");
  const guestMessages = []; const hostListeners = new Map(); const windowListeners = new Map(); const guestStyles = new Map();
  const documentElement = {};
  const cssValue = (name) => {
    const text = guestStyles.get("gpt-obsidian-native-appearance")?.textContent || "";
    return new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*:\\s*([^;]+)`, "u").exec(text)?.[1]?.replace(/!important/gu, "").trim() || "";
  };
  const sandbox = {
    console, TextEncoder, URL, DOMException, CSS: { supports: (property, value) => property === "color" && !/[;{}]/u.test(value) },
    location: { hostname: "chatgpt.com" }, navigator: { clipboard: { async writeText() {} } },
    window: { addEventListener(name, callback) { windowListeners.set(name, callback); }, setTimeout, clearTimeout, setInterval, clearInterval,
      getComputedStyle(target) { return { display: "block", visibility: "visible", getPropertyValue: (name) => target === documentElement ? cssValue(name) : "" }; } },
    document: { readyState: "loading", hasFocus: () => true, querySelectorAll: () => [], getElementById: (id) => guestStyles.get(id) || null,
      createElement: () => ({}), head: { appendChild(node) { guestStyles.set(node.id, node); } }, documentElement },
    require(id) {
      if (id !== "electron") throw new Error(`sandbox preload cannot require ${id}`);
      return { ipcRenderer: { sendToHost(channel, payload) { guestMessages.push({ channel, payload }); }, on(channel, callback) { hostListeners.set(channel, callback); } },
        contextBridge: { exposeInMainWorld() {}, executeInMainWorld() { return false; } } };
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "live-preload.js" });
  const plugin = await makePlugin(); const item = await openView(plugin); plugin.app.workspace.active = item.view;
  const readyMessage = guestMessages.find((message) => message.channel === t.CHANNELS.READY);
  plugin.handleGuestMessage(item.view, { channel: readyMessage.channel, args: [readyMessage.payload] });
  for (const channel of [t.CHANNELS.CONFIG, t.CHANNELS.APPEARANCE]) {
    const outbound = item.webview.sent.filter((message) => message.channel === channel).at(-1);
    hostListeners.get(channel)?.(null, outbound.payload);
  }
  for (const message of guestMessages.filter((entry) => entry.channel === t.CHANNELS.DIAGNOSTIC)) {
    plugin.handleGuestMessage(item.view, { channel: message.channel, args: [message.payload] });
  }
  const input = { isTrusted: true, code: "BracketRight", key: "ъ", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true,
    repeat: false, isComposing: false, preventDefault() { this.prevented = (this.prevented || 0) + 1; }, stopPropagation() {} };
  const beforeKey = guestMessages.length; windowListeners.get("keydown")(input);
  for (const message of guestMessages.slice(beforeKey)) plugin.handleGuestMessage(item.view, { channel: message.channel, args: [message.payload] });
  const snapshot = plugin.diagnostics().views[0];
  assert.equal(snapshot.keyboard.preloadAcceptedDescriptors, plugin.hotkeyPayload.length);
  assert.deepEqual({ code: snapshot.keyboard.lastKeydown.code, key: snapshot.keyboard.lastKeydown.key,
    matched: snapshot.keyboard.lastKeydown.matched, sent: snapshot.keyboard.lastKeydown.keyboardIpcSent },
  { code: "BracketRight", key: "ъ", matched: true, sent: true });
  assert.equal(snapshot.keyboard.hostLastIpc.reason, "executed"); assert.equal(snapshot.keyboard.hostLastIpc.viewFocused, false);
  assert.deepEqual(plugin.app.calls, ["workspace:next-tab"]); assert.equal(input.prevented, 1);
  assert.equal(snapshot.appearance.preloadReceived, true); assert.equal(snapshot.appearance.applied, true);
  assert.equal(snapshot.appearance.styleExists, true); assert.deepEqual(snapshot.appearance.cssVars, snapshot.appearance.palette);
  assert.match(guestStyles.get("gpt-obsidian-native-appearance").textContent, /--text-quaternary:/u);
  assert.match(guestStyles.get("gpt-obsidian-native-appearance").textContent, /send-button[^}]+svg/isu);
  await item.view.onClose(); plugin.onunload();
});

test("B production preload diagnostics: missing READY is observable and late READY heals state", async () => {
  const plugin = await makePlugin(); const item = await openView(plugin); const originalError = console.error; console.error = () => {};
  try {
    item.webview.emit("dom-ready"); const timer = item.view.preloadTimer; assert.notEqual(timer, null); timers.get(timer)();
    assert.equal(item.view.preloadConnected, false); assert.equal(item.view.preloadStatus, "timeout");
    const snapshot = plugin.diagnostics().views[0];
    assert.equal(snapshot.preloadAttribute, plugin.preloadUrl); assert.equal(snapshot.preloadStatus, "timeout");
    ready(item.view); assert.equal(item.view.preloadConnected, true); assert.equal(item.view.preloadStatus, "ready"); assert.equal(item.view.preloadError, null);
  } finally { console.error = originalError; await item.view.onClose(); plugin.onunload(); }
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

test("B production startup: vault-relative manifest.dir resolves before preload provisioning", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-obsidian-startup-"));
  const runtimeDir = path.join(temporary, ".obsidian", "plugins", "gpt-obsidian");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const app = makeApp();
  app.vault = { adapter: { getFullPath(vaultPath) { return path.join(temporary, vaultPath); } } };
  const plugin = new Plugin(app);
  plugin.manifest.dir = ".obsidian/plugins/gpt-obsidian";
  try {
    await plugin.onload();
    assert.equal(plugin.preloadPath, path.join(runtimeDir, "preload.js"));
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(plugin.preloadPath)).digest("hex"), t.PRELOAD_SHA256);
    assert.equal(plugin.registeredViews.has(t.VIEW_TYPE), true);
  } finally {
    plugin.onunload();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
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

test("B focus: returning to an existing leaf focuses only that view prompt once", async () => {
  const plugin = await makePlugin(); const a = await openView(plugin); const b = await openView(plugin);
  ready(a.view); ready(b.view); a.webview.sent.length = 0; b.webview.sent.length = 0;
  plugin.app.workspace.active = a.view; plugin.app.workspace.emit("active-leaf-change", a.leaf);
  assert.equal(a.webview.focusCalls, 1); assert.equal(b.webview.focusCalls || 0, 0);
  const timer = a.view.activationFocusTimer; assert.notEqual(timer, null); timers.get(timer)();
  assert.equal(a.webview.sent.filter((message) => message.channel === t.CHANNELS.FOCUS).length, 1);
  assert.equal(b.webview.sent.filter((message) => message.channel === t.CHANNELS.FOCUS).length, 0);
  await a.view.onClose(); assert.equal(plugin.app.workspace.events.get("active-leaf-change").size, 1);
  await b.view.onClose(); assert.equal(plugin.app.workspace.events.get("active-leaf-change").size, 0); plugin.onunload();
});

test("B appearance: donor palette is sent view-locally on ready and css-change", async () => {
  const plugin = await makePlugin(); const { view, webview } = await openView(plugin); webview.sent.length = 0;
  ready(view);
  const appearance = webview.sent.find((message) => message.channel === t.CHANNELS.APPEARANCE);
  assert.deepEqual(appearance.payload.palette, { textColor: "rgb(238, 238, 238)", negative: "rgb(245, 235, 225)", negativeHover: "rgb(246, 237, 229)" });
  const before = webview.sent.length; plugin.app.workspace.emit("css-change");
  assert.equal(webview.sent.length, before + 1); assert.equal(webview.sent.at(-1).channel, t.CHANNELS.APPEARANCE);
  await view.onClose(); plugin.onunload();
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

test("C keyboard live regression: guest-focused IPC works when host webview focus event was absent", async () => {
  const plugin = await makePlugin(); const { view } = await openView(plugin); ready(view); plugin.app.workspace.active = view;
  assert.equal(view.focused, false); assert.equal(view.keyboardConnected, false);
  const token = plugin.hotkeyPayload[0].token;
  plugin.handleGuestMessage(view, { channel: t.CHANNELS.KEYBOARD, args: [{ version: 1, token, guestFocused: true }] });
  assert.deepEqual(plugin.app.calls, ["workspace:next-tab"]); assert.equal(view.keyboardConnected, true);
  assert.deepEqual({ reason: view.keyboardTrace.hostLastIpc.reason, viewFocused: view.keyboardTrace.hostLastIpc.viewFocused,
    guestFocused: view.keyboardTrace.hostLastIpc.guestFocused, activeViewIsView: view.keyboardTrace.hostLastIpc.activeViewIsView,
    commandId: view.keyboardTrace.hostLastIpc.commandId, executeResult: view.keyboardTrace.hostLastIpc.executeResult },
  { reason: "executed", viewFocused: false, guestFocused: true, activeViewIsView: true,
    commandId: "workspace:next-tab", executeResult: true });
  await view.onClose(); plugin.onunload();
});

test("C keyboard: two views never double-dispatch and closed view cannot dispatch", async () => {
  const plugin = await makePlugin(); const a = await openView(plugin); const b = await openView(plugin); ready(a.view); ready(b.view);
  const token = plugin.hotkeyPayload[0].token; a.view.focused = true; b.view.focused = true; plugin.app.workspace.active = b.view;
  plugin.handleKeyboardMessage(a.view, { version: 1, token, guestFocused: true }); plugin.handleKeyboardMessage(b.view, { version: 1, token, guestFocused: true });
  assert.equal(a.view.keyboardTrace.hostLastIpc.reason, "different-active-gpt-view");
  assert.equal(plugin.app.calls.length, 1); await b.view.onClose(); plugin.handleKeyboardMessage(b.view, { version: 1, token, guestFocused: true });
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
  assert.equal(item.view.bridge.state, t.BRIDGE_STATES.CONNECTING); ready(item.view);
  assert.equal(item.view.bridge.state, t.BRIDGE_STATES.CONNECTED); assert.equal(item.view.bridge.sessionId, "backend-2");
  manager.session.getBackendSessionId = () => "backend-3"; plugin.reconcileBridge(); assert.equal(item.view.bridge.sessionId, "backend-3");
  await item.view.onClose(); plugin.onunload();
});

test("D permission UI: compact current-view action represents every bridge state", async () => {
  const manager = makeManager(); const plugin = await makePlugin(makeApp(manager)); const item = await openView(plugin);
  const states = [
    t.BRIDGE_STATES.OFF, t.BRIDGE_STATES.COPILOT_UNAVAILABLE, t.BRIDGE_STATES.WAITING_AGENT,
    t.BRIDGE_STATES.WAITING_BACKEND, t.BRIDGE_STATES.STANDBY, t.BRIDGE_STATES.CONNECTING,
    t.BRIDGE_STATES.CONNECTED, t.BRIDGE_STATES.RECONNECTING, t.BRIDGE_STATES.ERROR
  ];
  for (const state of states) {
    item.view.bridge.state = state; plugin.updateBridgeStatus(item.view);
    assert.equal(item.view.bridgeAction.getAttribute("data-bridge-state"), state);
    assert.match(item.view.bridgeAction.getAttribute("aria-label"), /^GPT ↔ Copilot /u);
    assert.ok(item.view.bridgeIcon.icon); assert.ok(item.view.bridgeLabel.textContent);
  }
  item.view.bridge.enabled = false; item.view.bridgeAction.emit("click"); assert.equal(item.view.bridge.enabled, true);
  await item.view.onClose(); plugin.onunload();
});

test("B clipboard fallback: host accepts long Unicode markdown but rejects over 4 MiB", async () => {
  const plugin = await makePlugin(); const item = await openView(plugin);
  const payloads = [
    "x".repeat(100), "x".repeat(10 * 1024), "x".repeat(100 * 1024),
    "Русский текст 🌍\n".repeat(1000), "```js\nconst x = 1;\n```\n**markdown**"
  ];
  for (const [index, text] of payloads.entries()) {
    assert.equal(await plugin.handleClipboardWrite(item.view, { version: 1, requestId: `copy-${index}`, text }), true);
    assert.equal(global.__copied, text);
    assert.deepEqual(item.webview.sent.at(-1).payload, { version: 1, requestId: `copy-${index}`, ok: true });
  }
  const previous = global.__copied;
  assert.equal(await plugin.handleClipboardWrite(item.view, { version: 1, requestId: "too-large", text: "x".repeat(t.CLIPBOARD_MAX_BYTES + 1) }), false);
  assert.equal(global.__copied, previous); assert.equal(item.webview.sent.at(-1).payload.ok, false);
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
