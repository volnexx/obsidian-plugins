const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin: class Plugin { constructor(app) { this.app = app; } },
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

global.window = globalThis;

const GptObsidianPlugin = require("./main.js");
const {
  bridgeDecisionPolicy,
  controlPrompt,
  hotkeyMatchesInput,
  isBridgeDecisionAllowed,
  isPermanentOption,
  parsePermissionDecision,
  permissionMeaning,
  requestNeedsNativeUi
} = GptObsidianPlugin._test;

class FakeGuest extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.destroyed = false;
    this.backgroundThrottling = true;
    this.inserted = [];
    this.state = null;
    this.focused = true;
    this.accepted = { ok: true, lastUserId: "u2", userCount: 2 };
  }

  isDestroyed() { return this.destroyed; }
  getBackgroundThrottling() { return this.backgroundThrottling; }
  setBackgroundThrottling(value) { this.backgroundThrottling = value; }
  isFocused() { return this.focused; }
  insertText(text) { this.inserted.push(text); }
  sendInputEvent() {}
  async executeJavaScript(script) {
    if (script.includes("assistantCount:")) return this.state;
    if (script.includes("prompt unavailable")) return { ok: true };
    if (script.includes("composer-submit-button")) return true;
    if (script.includes("lastUserId")) return this.accepted;
    throw new Error("unexpected guest script");
  }
}

class FakeWebview {
  constructor(id, connected = true, url = "https://chatgpt.com/c/linked") {
    this.id = id;
    this.isConnected = connected;
    this.url = url;
    this.listeners = new Map();
    this.attributes = new Map([["src", url]]);
  }

  getURL() { return this.url; }
  getWebContentsId() { return this.id; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  emit(name, ...args) { for (const listener of this.listeners.get(name) || []) listener(...args); }
  listenerCount(name) { return this.listeners.get(name)?.size || 0; }
}

function makePlugin(leaf, guests) {
  const leaves = Array.isArray(leaf) ? leaf : [leaf];
  const app = {
    workspace: {
      activeLeaf: null,
      iterateAllLeaves: (visit) => leaves.forEach(visit),
      on: () => ({})
    },
    plugins: { plugins: {} },
    commands: { commands: {}, executeCommandById: () => false },
    hotkeyManager: { customKeys: {}, defaultKeys: {} }
  };
  const plugin = new GptObsidianPlugin(app);
  plugin.settings = { textColorMode: "theme", allowPermanentApprovals: false };
  plugin.activationSerial = 0;
  plugin.boundWebviews = new Map();
  plugin.destroyedWebviews = new WeakSet();
  plugin.guestBindings = new Map();
  plugin.bridgeBindings = new Map();
  plugin.bridgeBindingsByLeafId = new Map();
  plugin.copilotUnregister = null;
  plugin.copilotManagerUnsubscribe = null;
  plugin.copilotManager = null;
  plugin.copilotRetryTimer = null;
  plugin.copilotRetryIndex = 0;
  plugin.bridgeSessionWatchTimer = null;
  plugin.bridgeWaitingSerial = 0;
  plugin.bridgeUnloaded = false;
  plugin.copilotResolver = (requestValue, context) => plugin.resolveCopilotPermission(requestValue, context);
  plugin.copilotPermissionBridgeSerial = 0;
  plugin.copilotBridgePrompter = null;
  plugin.copilotBridgeWirePrompters = null;
  plugin.copilotBackendPermissionPrompters = new Map();
  plugin.copilotNativeUiTracePatches = new Set();
  plugin.permissionTraceObjectIds = new WeakMap();
  plugin.permissionTraceObjectSerial = 0;
  plugin.remote = { webContents: { fromId: (id) => guests.get(id) || null } };
  plugin.bindWebview = () => undefined;
  return plugin;
}

function keyboardFixture({
  commands = ["workspace:next-tab"],
  hotkeys = {
    "workspace:next-tab": [{ modifiers: ["Ctrl", "Alt"], key: "ArrowRight" }]
  },
  execute = () => true,
  id = 501
} = {}) {
  const guest = new FakeGuest(id);
  const webview = new FakeWebview(id, true, `https://chatgpt.com/c/keyboard-${id}`);
  const leaf = { id: `leaf-keyboard-${id}`, view: { webview, containerEl: null } };
  const guests = new Map([[id, guest]]);
  const plugin = makePlugin(leaf, guests);
  const calls = [];
  plugin.app.workspace.activeLeaf = leaf;
  plugin.app.commands.commands = Object.fromEntries(commands.map((commandId) => [commandId, { id: commandId }]));
  plugin.app.commands.executeCommandById = (commandId) => {
    calls.push(commandId);
    return execute(commandId);
  };
  plugin.app.hotkeyManager.customKeys = hotkeys;
  plugin.bridgeBindingFor = () => null;
  plugin.applyAppearance = () => true;
  plugin.schedulePromptFocus = () => undefined;

  GptObsidianPlugin.prototype.bindWebview.call(plugin, webview);
  webview.emit("dom-ready");

  return { plugin, guest, guests, webview, leaf, calls };
}

function keyboardEvent() {
  return {
    defaultPrevented: false,
    preventDefaultCalls: 0,
    preventDefault() {
      this.defaultPrevented = true;
      this.preventDefaultCalls += 1;
    }
  };
}

function guestKey(guest, input) {
  const event = keyboardEvent();
  guest.emit("before-input-event", event, input);
  return event;
}

function modifiedKey(key, code, overrides = {}) {
  return {
    type: "keyDown",
    key,
    code,
    control: true,
    meta: false,
    alt: true,
    shift: false,
    isComposing: false,
    ...overrides
  };
}

function request(options = null) {
  return {
    sessionId: "session-1",
    toolCall: {
      toolCallId: "request-1",
      title: "Run command",
      kind: "execute",
      status: "pending",
      rawInput: { command: "printf ok", cwd: "/vault" }
    },
    options: options || [
      { optionId: "allow_once", kind: "allow_once", name: "Allow Once" },
      { optionId: "allow_always", kind: "allow_always", name: "Allow for Session" },
      { optionId: "reject_once", kind: "reject_once", name: "Reject" }
    ]
  };
}

function currentPermissionOptions() {
  return [
    { optionId: "allow_always", kind: "allow_always", name: "Allow" },
    { optionId: "session-opaque-token", kind: "allow_always", name: "Allow for This Session" },
    { optionId: "permanent-opaque-token", kind: "allow_always", name: "Allow and Don't Ask Again" },
    { optionId: "decline-opaque-token", kind: "reject_once", name: "Decline" },
    { optionId: "block-always-token", kind: "reject_always", name: "Block Always" }
  ];
}

const PERMISSION_REGRESSION_FIXTURES = [
  {
    requestId: "exec-89c9d204-63a8-475d-8d0f-fe0302bf4b34",
    correlationNonce: "10101d6f-9136-4799-8ce8-d5b608e97bc2"
  },
  {
    requestId: "exec-0af8a01b-73b1-4c37-ad8c-89a4a3a377dd",
    correlationNonce: "d43482cd-550b-4c2c-925c-a1918c483dd5"
  }
];

function permissionRegressionRequest(fixture) {
  return {
    sessionId: "session-1",
    toolCall: {
      toolCallId: fixture.requestId,
      title: "Run command",
      kind: "execute",
      status: "pending",
      rawInput: {
        command: "cp -- /home/mcmarkus/Documents/system-obsidian/obsidian/dev/gpt-obsidian/main.js /home/mcmarkus/Documents/system-obsidian/obsidian/.obsidian/plugins/gpt-obsidian/main.js"
      }
    },
    options: [
      { optionId: "allow_once", kind: "allow_once", name: "Allow Once" },
      { optionId: "allow_always", kind: "allow_always", name: "Allow for Session" },
      { optionId: "accept_execpolicy_amendment", kind: "allow_always", name: "Allow Always" },
      { optionId: "reject_once", kind: "reject_once", name: "Reject" }
    ]
  };
}

function strict(requestValue, optionId, correlationNonce, displayedSessionId = null) {
  return `<GPT_COPILOT_CONTROL version="1">
requestId: ${requestValue.toolCall.toolCallId}
${displayedSessionId == null ? "" : `sessionId: ${displayedSessionId}\n`}correlationNonce: ${correlationNonce}
action: permission_decision
optionId: ${optionId}
</GPT_COPILOT_CONTROL>`;
}

function bridgeBinding(leaf, webview, guest) {
  return {
    leaf,
    leafId: leaf.id,
    webview,
    guestWebContents: guest,
    guestWebContentsId: guest.id,
    guestBackgroundThrottling: null,
    button: { isConnected: true },
    state: "ON",
    enabled: true,
    sessionId: "session-1",
    staleSessionId: null,
    waitingOrder: null,
    pending: null
  };
}

class FakeAgentSession {
  constructor(sessionId, status = "idle") {
    this.sessionId = sessionId;
    this.status = status;
  }

  getBackendSessionId() { return this.sessionId; }
  getStatus() { return this.status; }
}

class FakeAgentSessionManager {
  constructor() {
    this.activeSession = null;
    this.sessions = new Map();
    this.listeners = new Set();
    this.resolvers = new Set();
  }

  registerExternalPermissionResolver(resolver) {
    this.resolvers.add(resolver);
    return () => this.resolvers.delete(resolver);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getActiveSession() { return this.activeSession; }
  getSessionByBackendId(sessionId) { return this.sessions.get(sessionId) || null; }

  setActiveSession(session) {
    this.activeSession = session;
    if (session?.getBackendSessionId()) this.sessions.set(session.getBackendSessionId(), session);
    this.notify();
  }

  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.status = "closed";
    this.sessions.delete(sessionId);
    if (this.activeSession === session) this.activeSession = null;
    this.notify();
  }

  notify() {
    for (const listener of [...this.listeners]) listener();
  }
}

function lifecycleFixture(count = 1) {
  const guests = new Map();
  const leaves = [];
  const webviews = [];
  for (let index = 0; index < count; index += 1) {
    const id = 100 + index;
    const guest = new FakeGuest(id);
    const webview = new FakeWebview(id, true, `https://chatgpt.com/c/lifecycle-${index}`);
    const leaf = { id: `leaf-lifecycle-${index}`, view: { webview, containerEl: null } };
    guests.set(id, guest);
    leaves.push(leaf);
    webviews.push(webview);
  }
  const plugin = makePlugin(leaves, guests);
  const manager = new FakeAgentSessionManager();
  plugin.app.plugins.plugins.copilot = { agentSessionManager: manager };
  const bindings = leaves.map((leaf, index) => {
    const binding = bridgeBinding(leaf, webviews[index], guests.get(100 + index));
    binding.state = "OFF";
    binding.enabled = false;
    binding.sessionId = null;
    binding.button = { isConnected: true, textContent: "", title: "", remove() {} };
    plugin.bridgeBindings.set(webviews[index], binding);
    plugin.bridgeBindingsByLeafId.set(leaf.id, binding);
    return binding;
  });
  return { plugin, manager, bindings, leaves, webviews, guests };
}

function cleanupLifecycle({ plugin, bindings }) {
  for (const binding of bindings) plugin.disableBridgeBinding(binding, "OFF");
  plugin.stopBridgeSessionWatch();
  try { plugin.copilotUnregister?.(); } catch (_) {}
  plugin.copilotUnregister = null;
  plugin.copilotManager = null;
  if (plugin.copilotRetryTimer != null) window.clearTimeout(plugin.copilotRetryTimer);
  plugin.copilotRetryTimer = null;
}

async function startLifecyclePending({
  hidden = false,
  baselineUserCount = 1,
  acceptedUserCount = 2,
  options = null,
  allowPermanentApprovals = false
} = {}) {
  const guest = new FakeGuest(11);
  const webview = new FakeWebview(11, !hidden, "https://chatgpt.com/");
  const leaf = { id: "leaf-chatgpt", view: { webview, containerEl: null } };
  const guests = new Map([[11, guest]]);
  const plugin = makePlugin(leaf, guests);
  plugin.settings.allowPermanentApprovals = allowPermanentApprovals;
  plugin.bindWebview = GptObsidianPlugin.prototype.bindWebview.bind(plugin);
  const binding = bridgeBinding(leaf, webview, guest);
  plugin.bridgeBindings.set(webview, binding);
  plugin.bridgeBindingsByLeafId.set(leaf.id, binding);
  plugin.copilotManager = { getSessionByBackendId: () => ({ getStatus: () => "idle" }) };
  plugin.bindWebview(webview);

  const requestValue = request(options);
  guest.accepted = { ok: true, lastUserId: "u2", userCount: acceptedUserCount };
  guest.state = {
    generating: false,
    assistantCount: 1,
    lastAssistant: { id: "a1", text: "old" },
    userCount: baselineUserCount,
    lastUserId: "u1"
  };
  const resolving = plugin.resolveCopilotPermission(requestValue, { backendId: "codex" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(binding.pending);
  assert.ok(binding.pending.pollTimer);
  return { plugin, binding, leaf, webview, guest, guests, requestValue, resolving };
}

async function completeLifecyclePending(state, optionId = "allow_once") {
  const { plugin, binding, guest, requestValue, resolving } = state;
  const response = strict(requestValue, optionId, binding.pending.correlationNonce);
  binding.pending.lastText = response;
  binding.pending.changedAt = Date.now() - 2000;
  guest.state = {
    generating: false,
    assistantCount: 2,
    lastAssistant: { id: "a2", text: response },
    userCount: 2,
    lastUserId: "u2"
  };
  await plugin.pollBridgePermission(binding, binding.pending);
  return resolving;
}

async function resolveThroughGuest({ hidden = false, replaceDuringPending = false } = {}) {
  const guest = new FakeGuest(11);
  const firstWebview = new FakeWebview(11, !hidden);
  const leaf = { id: "leaf-chatgpt", view: { webview: firstWebview, containerEl: null } };
  const plugin = makePlugin(leaf, new Map([[11, guest]]));
  const binding = bridgeBinding(leaf, firstWebview, guest);
  plugin.bridgeBindings.set(firstWebview, binding);
  plugin.bridgeBindingsByLeafId.set(leaf.id, binding);
  plugin.copilotManager = { getSessionByBackendId: () => ({ getStatus: () => "idle" }) };

  const requestValue = request();
  guest.state = {
    generating: false,
    assistantCount: 1,
    lastAssistant: { id: "a1", text: "old" },
    userCount: 1,
    lastUserId: "u1"
  };
  const resolving = plugin.resolveCopilotPermission(requestValue, { backendId: "codex" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(binding.pending);

  if (replaceDuringPending) {
    const replacement = new FakeWebview(11, true);
    leaf.view.webview = replacement;
    plugin.reconcileBridgeBindings();
    assert.equal(binding.webview, replacement);
    assert.ok(binding.pending);
  }

  const response = strict(requestValue, "allow_always", binding.pending.correlationNonce);
  binding.pending.lastText = response;
  binding.pending.changedAt = Date.now() - 2000;
  guest.state = {
    generating: false,
    assistantCount: 2,
    lastAssistant: { id: "a2", text: response },
    userCount: 2,
    lastUserId: "u2"
  };
  await plugin.pollBridgePermission(binding, binding.pending);
  const decision = await resolving;
  assert.deepEqual(decision, { outcome: { outcome: "selected", optionId: "allow_always" } });
  assert.equal(binding.pending, null);
  assert.equal(guest.inserted.length, 1);
  assert.equal(guest.backgroundThrottling, false);
  return { plugin, binding, leaf, guest };
}

test("OFF with no Agent session enters WAITING", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    assert.equal(fixture.bindings[0].state, "WAITING");
    assert.equal(fixture.bindings[0].enabled, false);
    assert.match(fixture.bindings[0].button.textContent, /No Agent session/);
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("WAITING click always returns to OFF", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    assert.equal(fixture.bindings[0].state, "OFF");
    assert.equal(fixture.bindings[0].sessionId, null);
    assert.equal(fixture.bindings[0].button.textContent, "GPT ↔ Copilot OFF");
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("OFF with an existing active Agent session enters ON", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.manager.setActiveSession(new FakeAgentSession("session-existing"));
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    assert.equal(fixture.bindings[0].state, "ON");
    assert.equal(fixture.bindings[0].sessionId, "session-existing");
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("WAITING automatically enters ON when an Agent session appears", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    fixture.manager.setActiveSession(new FakeAgentSession("session-later"));
    assert.equal(fixture.bindings[0].state, "ON");
    assert.equal(fixture.bindings[0].sessionId, "session-later");
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("ON click always returns to OFF", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.manager.setActiveSession(new FakeAgentSession("session-on"));
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    assert.equal(fixture.bindings[0].state, "OFF");
    assert.equal(fixture.bindings[0].sessionId, null);
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("ON enters WAITING when its Agent session disappears", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.manager.setActiveSession(new FakeAgentSession("session-closing"));
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    fixture.manager.closeSession("session-closing");
    assert.equal(fixture.bindings[0].state, "WAITING");
    assert.equal(fixture.bindings[0].sessionId, null);
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("ON to WAITING automatically rebinds to the next Agent session", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.manager.setActiveSession(new FakeAgentSession("session-first"));
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    fixture.manager.closeSession("session-first");
    assert.equal(fixture.bindings[0].state, "WAITING");
    fixture.manager.setActiveSession(new FakeAgentSession("session-second"));
    assert.equal(fixture.bindings[0].state, "ON");
    assert.equal(fixture.bindings[0].sessionId, "session-second");
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("WAITING to OFF cancels discovery of later Agent sessions", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    assert.equal(fixture.manager.listeners.size, 0);
    fixture.manager.setActiveSession(new FakeAgentSession("session-too-late"));
    assert.equal(fixture.bindings[0].state, "OFF");
    assert.equal(fixture.bindings[0].sessionId, null);
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("two WAITING GPT tabs give one Agent session exactly one owner", () => {
  const fixture = lifecycleFixture(2);
  try {
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    fixture.plugin.toggleBridge(fixture.bindings[1]);
    fixture.manager.setActiveSession(new FakeAgentSession("session-one-owner"));
    assert.equal(fixture.bindings[0].state, "ON");
    assert.equal(fixture.bindings[0].sessionId, "session-one-owner");
    assert.equal(fixture.bindings[1].state, "WAITING");
    assert.equal(fixture.bindings.filter((binding) => binding.sessionId === "session-one-owner").length, 1);
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("the next free Agent session is assigned to the next WAITING GPT tab", () => {
  const fixture = lifecycleFixture(2);
  try {
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    fixture.plugin.toggleBridge(fixture.bindings[1]);
    fixture.manager.setActiveSession(new FakeAgentSession("session-owner-one"));
    fixture.manager.setActiveSession(new FakeAgentSession("session-owner-two"));
    assert.equal(fixture.bindings[0].sessionId, "session-owner-one");
    assert.equal(fixture.bindings[1].state, "ON");
    assert.equal(fixture.bindings[1].sessionId, "session-owner-two");
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("OFF and unload clear Agent session watchers, timers, listeners, and pending intent", () => {
  const fixture = lifecycleFixture();
  fixture.plugin.toggleBridge(fixture.bindings[0]);
  assert.ok(fixture.plugin.bridgeSessionWatchTimer);
  assert.equal(fixture.manager.listeners.size, 1);

  fixture.plugin.toggleBridge(fixture.bindings[0]);
  assert.equal(fixture.plugin.bridgeSessionWatchTimer, null);
  assert.equal(fixture.manager.listeners.size, 0);

  fixture.plugin.toggleBridge(fixture.bindings[0]);
  assert.ok(fixture.plugin.bridgeSessionWatchTimer);
  fixture.plugin.onunload();
  assert.equal(fixture.plugin.bridgeSessionWatchTimer, null);
  assert.equal(fixture.manager.listeners.size, 0);
  assert.equal(fixture.manager.resolvers.size, 0);
  assert.equal(fixture.bindings[0].state, "OFF");
});

test("light fallback watcher discovers a session when manager notifications are unavailable", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.manager.subscribe = undefined;
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    const timer = fixture.plugin.bridgeSessionWatchTimer;
    assert.ok(timer);
    const session = new FakeAgentSession("session-fallback-watch");
    fixture.manager.activeSession = session;
    fixture.manager.sessions.set(session.getBackendSessionId(), session);
    timer._onTimeout();
    assert.equal(fixture.bindings[0].state, "ON");
    assert.equal(fixture.bindings[0].sessionId, "session-fallback-watch");
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("WAITING rebinds when Copilot replaces its manager and the resolver follows manager B", () => {
  const fixture = lifecycleFixture();
  try {
    fixture.plugin.toggleBridge(fixture.bindings[0]);
    const managerA = fixture.manager;
    const managerB = new FakeAgentSessionManager();
    fixture.plugin.app.plugins.plugins.copilot.agentSessionManager = managerB;

    fixture.plugin.bridgeSessionWatchTimer._onTimeout();
    assert.equal(managerA.resolvers.size, 0);
    assert.equal(managerB.resolvers.size, 1);
    assert.equal(fixture.plugin.copilotManager, managerB);

    managerB.setActiveSession(new FakeAgentSession("session-manager-b"));
    assert.equal(fixture.bindings[0].state, "ON");
    assert.equal(fixture.bindings[0].sessionId, "session-manager-b");
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("runtime permission-prompter bridge overrides native UI and restores it on detach", async () => {
  const fixture = lifecycleFixture();
  let nativeCalls = 0;
  const native = async () => {
    nativeCalls += 1;
    return { outcome: { outcome: "native" } };
  };
  const backend = { setPermissionPrompter(prompter) { this.prompter = prompter; } };
  const manager = {
    opts: { permissionPrompter: native },
    backends: new Map([["codex", backend]]),
    wirePrompters() {},
    getActiveSession() { return null; },
    getSessions() { return []; },
    subscribe() { return () => {}; }
  };
  try {
    let resolveBridge;
    fixture.plugin.copilotResolver = () => new Promise((resolve) => { resolveBridge = resolve; });
    fixture.plugin.app.plugins.plugins.copilot.agentSessionManager = manager;
    fixture.plugin.toggleBridge(fixture.bindings[0]);

    const permission = backend.prompter({ sessionId: "session-manager-b", toolCall: { toolCallId: "sequential-request" } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(nativeCalls, 0);
    resolveBridge({ outcome: { outcome: "selected", optionId: "allow_always" } });
    assert.deepEqual(await permission, { outcome: { outcome: "selected", optionId: "allow_always" } });
    assert.equal(nativeCalls, 0);
    fixture.plugin.copilotResolver = async () => null;
    assert.deepEqual(await backend.prompter({ sessionId: "session-manager-b" }), { outcome: { outcome: "native" } });
    assert.equal(nativeCalls, 1);
    fixture.plugin.detachCopilotManager();
    assert.equal(backend.prompter, native);
  } finally {
    cleanupLifecycle(fixture);
  }
});

test("both reproduced allow_once responses return selected directly without Native UI", async () => {
  for (const fixture of PERMISSION_REGRESSION_FIXTURES) {
    const leaf = { id: `leaf-${fixture.requestId}`, view: {} };
    const plugin = makePlugin(leaf, new Map());
    const requestValue = permissionRegressionRequest(fixture);
    let nativeCalls = 0;
    const nativePrompter = async () => {
      nativeCalls += 1;
      return { outcome: { outcome: "native" } };
    };
    const backend = {
      permissionPrompter: null,
      setPermissionPrompter(prompter) { this.permissionPrompter = prompter; }
    };
    const manager = {
      opts: { permissionPrompter: nativePrompter },
      backends: new Map([["codex", backend]]),
      wirePrompters() {},
      getActiveSession() { return null; },
      getSessions() { return []; }
    };
    plugin.copilotManager = manager;
    plugin.copilotResolver = async (received) => {
      assert.equal(received, requestValue);
      const response = strict(received, "allow_once", fixture.correlationNonce);
      const optionId = parsePermissionDecision(response, received, fixture.correlationNonce);
      assert.equal(optionId, "allow_once");
      assert.equal(requestNeedsNativeUi(received), false);
      assert.equal(bridgeDecisionPolicy(optionId, received, false).allowed, true);
      return { outcome: { outcome: "selected", optionId } };
    };

    const unregister = plugin.installCopilotPermissionPrompterBridge(manager);
    try {
      assert.deepEqual(await backend.permissionPrompter(requestValue), {
        outcome: { outcome: "selected", optionId: "allow_once" }
      });
      assert.equal(nativeCalls, 0, fixture.requestId);
      assert.deepEqual(plugin.permissionTransportTrace.requests[fixture.requestId], {
        bridgePrompterCallCount: 1,
        backendPrompterCallCount: 1,
        copilotResolverCallCount: 1,
        nativePrompterCallCount: 0,
        nativeUiEnqueueCount: 0,
        sendBridgeMessageCallCount: 0
      });
      const resolverReturned = plugin.permissionTransportTrace.entries.find((entry) =>
        entry.requestId === fixture.requestId && entry.event === "copilotResolver returned"
      );
      assert.equal(resolverReturned.willCallNative, false);
      assert.deepEqual(resolverReturned.resolverResult, {
        outcome: { outcome: "selected", optionId: "allow_once" }
      });
    } finally {
      unregister();
    }
  }
});

test("a second request for one logical tool call can enter Native UI after request A was bridge-selected", async () => {
  const fixture = PERMISSION_REGRESSION_FIXTURES[0];
  const requestA = permissionRegressionRequest(fixture);
  const requestB = {
    ...permissionRegressionRequest(fixture),
    toolCall: {
      ...permissionRegressionRequest(fixture).toolCall,
      toolCallId: "exec-logical-retry-b"
    }
  };
  const leaf = { id: "leaf-duplicate-permission", view: {} };
  const plugin = makePlugin(leaf, new Map());
  const pendingToolResolvers = new Map();
  const backend = {
    backend: { id: "codex" },
    permissionPrompter: null,
    setPermissionPrompter(prompter) { this.permissionPrompter = prompter; }
  };
  const session = {
    backend,
    backendId: "codex",
    pendingToolResolvers,
    getBackendSessionId() { return "session-1"; },
    handleToolPermission(requestValue) {
      return new Promise((resolve) => {
        pendingToolResolvers.set(requestValue.toolCall.toolCallId, { request: requestValue, resolve });
      });
    },
    resolveToolPermission(toolCallId, optionId) {
      const pending = pendingToolResolvers.get(toolCallId);
      if (!pending) return;
      pendingToolResolvers.delete(toolCallId);
      pending.resolve({ outcome: { outcome: "selected", optionId } });
    }
  };
  const nativePrompter = (requestValue) => session.handleToolPermission(requestValue);
  const manager = {
    opts: { permissionPrompter: nativePrompter },
    backends: new Map([["codex", backend]]),
    wirePrompters() {},
    getActiveSession() { return session; },
    getSessions() { return [session]; }
  };
  plugin.copilotManager = manager;
  plugin.copilotResolver = async () => ({
    outcome: { outcome: "selected", optionId: "allow_once" }
  });
  const unregister = plugin.installCopilotPermissionPrompterBridge(manager);
  plugin.reconcileCopilotNativeUiTrace(manager);
  try {
    assert.deepEqual(await backend.permissionPrompter(requestA), {
      outcome: { outcome: "selected", optionId: "allow_once" }
    });
    assert.equal(plugin.permissionTransportTrace.requests[requestA.toolCall.toolCallId].nativeUiEnqueueCount, 0);

    const nativePermission = nativePrompter(requestB);
    assert.equal(pendingToolResolvers.has(requestB.toolCall.toolCallId), true);
    assert.equal(plugin.permissionTransportTrace.requests[requestB.toolCall.toolCallId].nativeUiEnqueueCount, 1);
    const nativeEntry = plugin.permissionTransportTrace.entries.find((entry) =>
      entry.requestId === requestB.toolCall.toolCallId && entry.event === "native UI request enqueued"
    );
    const bridgeEntry = plugin.permissionTransportTrace.entries.find((entry) =>
      entry.requestId === requestA.toolCall.toolCallId && entry.event === "backend permissionPrompter received"
    );
    assert.ok(nativeEntry);
    assert.ok(bridgeEntry);
    assert.notEqual(nativeEntry.toolCallId, bridgeEntry.toolCallId);
    assert.equal(nativeEntry.sessionIdHash, bridgeEntry.sessionIdHash);
    assert.equal(nativeEntry.commandFingerprint, bridgeEntry.commandFingerprint);
    assert.equal(nativeEntry.backendId, "codex");
    assert.match(nativeEntry.sourceStack, /tracedHandleToolPermission|nativePrompter/);

    session.resolveToolPermission(requestB.toolCall.toolCallId, "allow_once");
    assert.deepEqual(await nativePermission, {
      outcome: { outcome: "selected", optionId: "allow_once" }
    });
  } finally {
    plugin.restoreCopilotNativeUiTrace(manager);
    unregister();
  }
});

test("visible linked GPT WebView resolves a strict permission through its guest", async () => {
  await resolveThroughGuest();
});

test("hidden-but-open GPT WebView resolves without using the stale host node", async () => {
  const { binding } = await resolveThroughGuest({ hidden: true });
  assert.equal(binding.leafId, "leaf-chatgpt");
});

test("hidden to visible replacement during pending keeps the same request and routing", async () => {
  await resolveThroughGuest({ hidden: true, replaceDuringPending: true });
});

test("DOM virtualization 3 to 4 to 3 does not block a correlated new assistant", async () => {
  const state = await startLifecyclePending({ baselineUserCount: 3, acceptedUserCount: 4 });
  const { plugin, binding, guest, requestValue, resolving } = state;
  const pending = binding.pending;
  const response = strict(requestValue, "allow_once", pending.correlationNonce, "[REDACTED]");
  pending.lastText = response;
  pending.changedAt = Date.now() - 2000;
  guest.state = {
    generating: false,
    assistantCount: 2,
    lastAssistant: { id: "a2", text: response },
    userCount: 3,
    lastUserId: "u2"
  };

  await plugin.pollBridgePermission(binding, pending);

  assert.deepEqual(await resolving, { outcome: { outcome: "selected", optionId: "allow_once" } });
  assert.equal(binding.pending, null);
});

test("redacted displayed sessionId parses with the internal UUID and correct nonce", () => {
  const requestValue = request();
  requestValue.sessionId = "06d7ca5f-e6b1-4d06-9de3-1b25e720651f";
  const nonce = "opaque-nonce-1";
  const response = strict(requestValue, "allow_once", nonce, "[REDACTED]");

  assert.equal(parsePermissionDecision(response, requestValue, nonce), "allow_once");
});

test("wrong correlation nonce rejects into native fallback", async () => {
  const state = await startLifecyclePending();
  const { plugin, binding, guest, requestValue, resolving } = state;
  const pending = binding.pending;
  const response = strict(requestValue, "allow_once", "wrong-nonce", "[REDACTED]");
  pending.lastText = response;
  pending.changedAt = Date.now() - 2000;
  guest.state = {
    generating: false,
    assistantCount: 2,
    lastAssistant: { id: "a2", text: response },
    userCount: 2,
    lastUserId: "u2"
  };

  await plugin.pollBridgePermission(binding, pending);

  assert.equal(await resolving, null);
  assert.equal(binding.pending, null);
});

test("stale old assistant id is not accepted even with a valid strict response", async () => {
  const state = await startLifecyclePending();
  const { plugin, binding, guest, requestValue, resolving } = state;
  const pending = binding.pending;
  const response = strict(requestValue, "allow_once", pending.correlationNonce);
  pending.lastText = response;
  pending.changedAt = Date.now() - 2000;
  guest.state = {
    generating: false,
    assistantCount: 2,
    lastAssistant: { id: "a1", text: response },
    userCount: 2,
    lastUserId: "u2"
  };

  await plugin.pollBridgePermission(binding, pending);

  assert.equal(binding.pending, pending);
  plugin.cancelBridgePending(binding);
  assert.equal(await resolving, null);
});

test("valid new strict response resolves before timeout", async () => {
  const state = await startLifecyclePending();
  const pending = state.binding.pending;

  assert.deepEqual(await completeLifecyclePending(state), {
    outcome: { outcome: "selected", optionId: "allow_once" }
  });
  assert.equal(pending.settled, true);
});

test("successful resolution clears timeout", async () => {
  const state = await startLifecyclePending();
  const pending = state.binding.pending;
  assert.ok(pending.timer);

  await completeLifecyclePending(state);

  assert.equal(pending.timer, null);
});

test("successful resolution clears poller", async () => {
  const state = await startLifecyclePending();
  const pending = state.binding.pending;
  assert.ok(pending.pollTimer);

  await completeLifecyclePending(state);

  assert.equal(pending.pollTimer, null);
});

test("cleanup after success does not resolve null or resolve twice", async () => {
  const state = await startLifecyclePending();
  const { plugin, binding } = state;
  const pending = binding.pending;
  const originalResolve = pending.resolve;
  const values = [];
  pending.resolve = (value) => {
    values.push(value);
    originalResolve(value);
  };

  await completeLifecyclePending(state);
  plugin.clearBridgePending(binding, pending);

  assert.equal(values.length, 1);
  assert.deepEqual(values[0], { outcome: { outcome: "selected", optionId: "allow_once" } });
});

test("no valid response reaches timeout and returns null", async () => {
  const state = await startLifecyclePending();
  const { binding, resolving } = state;
  const pending = binding.pending;
  assert.equal(typeof pending.timer?._onTimeout, "function");

  pending.timer._onTimeout();

  assert.equal(await resolving, null);
  assert.equal(binding.pending, null);
  assert.equal(pending.timer, null);
  assert.equal(pending.pollTimer, null);
});

test("first permission survives new-conversation SPA navigation on the same guest", async () => {
  const state = await startLifecyclePending();
  const { binding, leaf, webview, requestValue } = state;
  const pending = binding.pending;

  webview.url = "https://chatgpt.com/c/123";
  webview.emit("did-navigate-in-page", {}, webview.url, true);

  assert.equal(binding.pending, pending);
  assert.equal(binding.leafId, leaf.id);
  assert.equal(binding.guestWebContentsId, 11);
  assert.equal(binding.pending.requestId, requestValue.toolCall.toolCallId);
  assert.equal(binding.pending.sessionId, requestValue.sessionId);
  assert.deepEqual(binding.lastNavigation, {
    kind: "in-page",
    url: "https://chatgpt.com/c/123",
    isMainFrame: true,
    leafId: leaf.id,
    bindingStable: true,
    leafStable: true,
    previousGuestWebContentsId: 11,
    guestWebContentsId: 11,
    guestStable: true,
    requestId: requestValue.toolCall.toolCallId,
    sessionId: requestValue.sessionId,
    pendingPreserved: true
  });
  assert.deepEqual(await completeLifecyclePending(state), {
    outcome: { outcome: "selected", optionId: "allow_once" }
  });
});

test("SPA navigation during polling preserves poller, timeout, and correlation", async () => {
  const state = await startLifecyclePending();
  const { binding, webview, requestValue } = state;
  const pending = binding.pending;
  const timer = pending.timer;
  const pollTimer = pending.pollTimer;

  webview.url = "https://chatgpt.com/c/123";
  webview.emit("did-navigate-in-page", {}, webview.url, true);

  assert.equal(binding.pending, pending);
  assert.equal(pending.timer, timer);
  assert.equal(pending.pollTimer, pollTimer);
  assert.equal(pending.requestId, requestValue.toolCall.toolCallId);
  assert.equal(pending.sessionId, requestValue.sessionId);
  assert.deepEqual(await completeLifecyclePending(state), {
    outcome: { outcome: "selected", optionId: "allow_once" }
  });
});

test("hidden GPT transport survives new-conversation SPA navigation", async () => {
  const state = await startLifecyclePending({ hidden: true });
  const { binding, webview, guest } = state;
  const pending = binding.pending;

  webview.url = "https://chatgpt.com/c/hidden";
  webview.emit("did-navigate-in-page", {}, webview.url, true);

  assert.equal(binding.pending, pending);
  assert.equal(binding.guestWebContents, guest);
  assert.deepEqual(await completeLifecyclePending(state), {
    outcome: { outcome: "selected", optionId: "allow_once" }
  });
});

test("real document navigation cancels pending into native fallback", async () => {
  const state = await startLifecyclePending();
  const { binding, webview, resolving } = state;
  const pending = binding.pending;

  webview.url = "https://chatgpt.com/c/reloaded";
  webview.emit("did-navigate", {}, webview.url, 200, "OK");

  assert.equal(await resolving, null);
  assert.equal(binding.pending, null);
  assert.equal(pending.timer, null);
  assert.equal(pending.pollTimer, null);
  assert.equal(binding.lastNavigation.kind, "document");
  assert.equal(binding.lastNavigation.guestStable, true);
  assert.equal(binding.lastNavigation.pendingPreserved, false);
});

test("in-page event with a changed guest identity cancels an unsafe stale binding", async () => {
  const state = await startLifecyclePending();
  const { binding, webview, guests, resolving } = state;
  const pending = binding.pending;
  const replacementGuest = new FakeGuest(12);
  guests.set(12, replacementGuest);
  webview.id = 12;
  webview.url = "https://chatgpt.com/c/replaced-guest";

  webview.emit("did-navigate-in-page", {}, webview.url, true);

  assert.equal(await resolving, null);
  assert.equal(binding.pending, null);
  assert.equal(pending.timer, null);
  assert.equal(pending.pollTimer, null);
  assert.equal(binding.lastNavigation.bindingStable, true);
  assert.equal(binding.lastNavigation.leafStable, true);
  assert.equal(binding.lastNavigation.previousGuestWebContentsId, 11);
  assert.equal(binding.lastNavigation.guestWebContentsId, 12);
  assert.equal(binding.lastNavigation.guestStable, false);
  assert.equal(binding.lastNavigation.pendingPreserved, false);
});

test("destroyed guest without replacement cancels pending and clears timers", async () => {
  const state = await startLifecyclePending();
  const { binding, guest, resolving } = state;
  const pending = binding.pending;

  guest.destroyed = true;
  guest.emit("destroyed");

  assert.equal(await resolving, null);
  assert.equal(binding.pending, null);
  assert.equal(pending.timer, null);
  assert.equal(pending.pollTimer, null);
  assert.equal(guest.listenerCount("destroyed"), 0);
  assert.equal(guest.listenerCount("before-input-event"), 0);
});

test("bridge OFF during pending immediately cancels into native fallback", async () => {
  const state = await startLifecyclePending();
  const { plugin, binding, resolving } = state;
  const pending = binding.pending;

  plugin.disableBridgeBinding(binding, "OFF");

  assert.equal(await resolving, null);
  assert.equal(binding.pending, null);
  assert.equal(pending.timer, null);
  assert.equal(pending.pollTimer, null);
  assert.equal(binding.enabled, false);
});

test("visible-hidden-visible after SPA keeps one binding and poller without keyboard listeners", async () => {
  const state = await startLifecyclePending();
  const { plugin, binding, leaf, webview, guest } = state;
  const pending = binding.pending;
  const pollTimer = pending.pollTimer;

  webview.url = "https://chatgpt.com/c/123";
  webview.emit("did-navigate-in-page", {}, webview.url, true);
  for (const connected of [false, true]) {
    const replacement = new FakeWebview(11, connected, webview.url);
    leaf.view.webview = replacement;
    plugin.reconcileBridgeBindings();
  }

  assert.equal(plugin.bridgeBindingsByLeafId.size, 1);
  assert.equal(plugin.bridgeBindingsByLeafId.get(leaf.id), binding);
  assert.equal(plugin.bridgeBindings.size, 1);
  assert.equal(binding.pending, pending);
  assert.equal(binding.pending.pollTimer, pollTimer);
  assert.equal(guest.listenerCount("destroyed"), 0);
  assert.equal(guest.listenerCount("before-input-event"), 0);
  assert.deepEqual(await completeLifecyclePending(state), {
    outcome: { outcome: "selected", optionId: "allow_once" }
  });
});

test("multiple hide/show replacements retain one leaf binding and no duplicate poller", () => {
  const guest = new FakeGuest(11);
  const first = new FakeWebview(11, true);
  const leaf = { id: "leaf-chatgpt", view: { webview: first, containerEl: null } };
  const plugin = makePlugin(leaf, new Map([[11, guest]]));
  plugin.copilotManager = {
    getSessionByBackendId: () => ({ getStatus: () => "idle" })
  };
  const binding = bridgeBinding(leaf, first, guest);
  binding.pending = { pollTimer: 77, settled: false };
  plugin.bridgeBindings.set(first, binding);
  plugin.bridgeBindingsByLeafId.set(leaf.id, binding);

  for (const connected of [false, true, false, true]) {
    const replacement = new FakeWebview(11, connected);
    leaf.view.webview = replacement;
    plugin.reconcileBridgeBindings();
    assert.equal(binding.webview, replacement);
    assert.equal(binding.pending.pollTimer, 77);
    assert.equal(plugin.bridgeBindingsByLeafId.size, 1);
    assert.equal(plugin.bridgeBindingsByLeafId.get(leaf.id), binding);
  }
  binding.pending = null;
  plugin.stopBridgeSessionWatch();
});

test("allow_always backend token derives SESSION semantics from its actual name", () => {
  const requestValue = request();
  const sessionOption = requestValue.options[1];
  const nonce = "option-semantics-nonce";

  assert.equal(permissionMeaning(sessionOption), "session");
  assert.equal(isPermanentOption(sessionOption), false);
  assert.equal(parsePermissionDecision("Allow for Session", requestValue), "allow_always");
  assert.equal(parsePermissionDecision("Allow Always", requestValue), null);
  assert.equal(parsePermissionDecision(strict(requestValue, "allow_always", nonce), requestValue, nonce), "allow_always");
  assert.equal(isBridgeDecisionAllowed("allow_always", requestValue, false), true);
});

test("current Copilot option names define semantics while optionId stays opaque", () => {
  const options = currentPermissionOptions();
  const requestValue = request(options);
  const nonce = "current-option-nonce";

  assert.deepEqual(options.map(permissionMeaning), ["once", "session", "permanent", "reject", "reject"]);
  assert.equal(isPermanentOption(options[0]), false);
  assert.equal(isPermanentOption(options[2]), true);
  assert.equal(parsePermissionDecision(strict(requestValue, "allow_always", nonce), requestValue, nonce), "allow_always");
  assert.equal(isBridgeDecisionAllowed("allow_always", requestValue, false), true);
  assert.equal(bridgeDecisionPolicy("allow_always", requestValue, false).meaning, "once");
  assert.equal(isBridgeDecisionAllowed("session-opaque-token", requestValue, false), true);
  assert.equal(isBridgeDecisionAllowed("decline-opaque-token", requestValue, false), true);
  assert.equal(isBridgeDecisionAllowed("block-always-token", requestValue, false), true);
  assert.equal(isBridgeDecisionAllowed("permanent-opaque-token", requestValue, false), false);
  assert.equal(isBridgeDecisionAllowed("permanent-opaque-token", requestValue, true), true);
});

test("reliable metadata is used when present and opaque kind is only a safe fallback", () => {
  assert.equal(permissionMeaning({
    optionId: "metadata-session",
    name: "Continue",
    kind: "allow_always",
    _meta: { permission: { scope: "this_session" } }
  }), "session");
  assert.equal(permissionMeaning({
    optionId: "metadata-permanent",
    name: "Allow",
    kind: "allow_always",
    _meta: { codex: { decision: "acceptWithExecpolicyAmendment" } }
  }), "permanent");
  assert.equal(permissionMeaning({
    optionId: "opaque-unknown",
    name: "Continue",
    kind: "allow_always"
  }), "unknown");
});

test("current misleading allow_always token resolves as one-time without Native UI fallback", async () => {
  const state = await startLifecyclePending({ options: currentPermissionOptions() });

  assert.deepEqual(await completeLifecyclePending(state, "allow_always"), {
    outcome: { outcome: "selected", optionId: "allow_always" }
  });
  const accepted = state.plugin.bridgePermissionTrace.entries.find((entry) => entry.event === "policy accepted");
  assert.equal(accepted.optionName, "Allow");
  assert.equal(accepted.meaning, "once");
});

test("current session and decline choices return their exact request optionId", async () => {
  for (const optionId of ["session-opaque-token", "decline-opaque-token"]) {
    const state = await startLifecyclePending({ options: currentPermissionOptions() });
    assert.deepEqual(await completeLifecyclePending(state, optionId), {
      outcome: { outcome: "selected", optionId }
    });
  }
});

test("only an actual Allow Always choice is classified as permanent", () => {
  const permanent = {
    optionId: "accept_execpolicy_amendment",
    kind: "allow_always",
    name: "Allow Always"
  };
  const requestValue = request([...request().options, permanent]);

  assert.equal(permissionMeaning(permanent), "permanent");
  assert.equal(isPermanentOption(permanent), true);
  assert.equal(parsePermissionDecision("Allow Always", requestValue), "accept_execpolicy_amendment");
  assert.equal(
    parsePermissionDecision(strict(requestValue, "accept_execpolicy_amendment", "permanent-nonce"), requestValue, "permanent-nonce"),
    "accept_execpolicy_amendment"
  );
  assert.equal(isBridgeDecisionAllowed("accept_execpolicy_amendment", requestValue, false), false);
  assert.equal(isBridgeDecisionAllowed("accept_execpolicy_amendment", requestValue, true), true);
});

test("permanent approval disabled rejects the bridge decision into native fallback", async () => {
  const permanent = { optionId: "accept_execpolicy_amendment", kind: "allow_always", name: "Allow Always" };
  const state = await startLifecyclePending({ options: [...request().options, permanent] });

  assert.equal(await completeLifecyclePending(state, "accept_execpolicy_amendment"), null);
  assert.equal(state.binding.pending, null);
});

test("current permanent label falls back with the exact policy reason when disabled", async () => {
  const state = await startLifecyclePending({ options: currentPermissionOptions() });

  assert.equal(await completeLifecyclePending(state, "permanent-opaque-token"), null);
  const fallback = state.plugin.bridgePermissionTrace.entries.find((entry) =>
    entry.event === "fallback" && entry.reason === "permanent approval requires Copilot Native UI"
  );
  assert.ok(fallback);
});

test("permanent approval enabled can pass the bridge when no other native-only rule applies", async () => {
  const permanent = { optionId: "accept_execpolicy_amendment", kind: "allow_always", name: "Allow Always" };
  const state = await startLifecyclePending({
    options: [...request().options, permanent],
    allowPermanentApprovals: true
  });

  assert.doesNotMatch(state.guest.inserted[0], /Do NOT choose "Allow Always"/);
  assert.deepEqual(await completeLifecyclePending(state, "accept_execpolicy_amendment"), {
    outcome: { outcome: "selected", optionId: "accept_execpolicy_amendment" }
  });
});

test("rm of a file inside tmp accepts bridge allow_once", () => {
  const requestValue = request();
  requestValue.toolCall.rawInput = { cmd: "rm /tmp/test.txt" };

  assert.equal(requestNeedsNativeUi(requestValue), false);
  assert.equal(isBridgeDecisionAllowed("allow_once", requestValue, false), true);
});

test("rm of a vault file outside tmp requires native UI", () => {
  const requestValue = request();
  requestValue.toolCall.rawInput = { cmd: "rm /home/mcmarkus/Documents/obsidian/test.md" };

  assert.equal(requestNeedsNativeUi(requestValue), true);
  assert.equal(isBridgeDecisionAllowed("allow_once", requestValue, false), false);
});

test("recursive or forced rm requires native UI even inside tmp", () => {
  const requestValue = request();

  for (const command of ["rm -rf /tmp/test", "rm -r /tmp/test", "rm --recursive /tmp/test", "rm --force /tmp/test"]) {
    requestValue.toolCall.rawInput = { cmd: command };
    assert.equal(requestNeedsNativeUi(requestValue), true, command);
    assert.equal(isBridgeDecisionAllowed("allow_once", requestValue, false), false, command);
  }
});

test("native-only request is routed before any GPT permission prompt is sent", async () => {
  const guest = new FakeGuest(411);
  const webview = new FakeWebview(411, true);
  const leaf = { id: "leaf-native-only", view: { webview, containerEl: null } };
  const plugin = makePlugin(leaf, new Map([[411, guest]]));
  const binding = bridgeBinding(leaf, webview, guest);
  plugin.bridgeBindings.set(webview, binding);
  plugin.bridgeBindingsByLeafId.set(leaf.id, binding);
  plugin.copilotManager = { getSessionByBackendId: () => ({ getStatus: () => "idle" }) };
  const requestValue = request(currentPermissionOptions());
  requestValue.toolCall.rawInput = { cmd: "rm /vault/private.md" };

  assert.equal(await plugin.resolveCopilotPermission(requestValue, { backendId: "codex" }), null);
  assert.equal(binding.pending, null);
  assert.equal(guest.inserted.length, 0);
  assert.equal(plugin.bridgePermissionTrace.entries.at(-1).reason, "request is native-only under the safety policy");
});

test("permission prompt defaults ordinary calls to Allow Once and explains available scopes by human-facing name", () => {
  const permanent = { optionId: "accept_execpolicy_amendment", kind: "allow_always", name: "Allow Always" };
  const prompt = controlPrompt(
    request([...request().options, permanent]),
    { backendId: "codex" },
    "prompt-nonce",
    false
  );
  assert.match(prompt, /Available permission choices:/);
  assert.match(prompt, /- Allow for Session\n  Return optionId: allow_always/);
  assert.match(prompt, /Permission selection policy:/);
  assert.match(prompt, /Prefer "Allow Once" for ordinary individual tool calls\. This is the default choice/);
  assert.match(prompt, /"Allow for Session" is session-level permission/);
  assert.match(prompt, /Do NOT choose "Allow Always".*permanent approval.*Copilot Native UI/);
  assert.match(prompt, /Use "Reject" when the requested action should not be allowed/);
  assert.match(prompt, /determine permission meaning from the human-facing option name, not from the backend optionId token/);
  assert.match(prompt, /optionId is an opaque backend token and may be misleading/);
  assert.match(prompt, /sessionId": "\[REDACTED\]"/);
  assert.match(prompt, /correlationNonce: prompt-nonce/);
});

test("permission prompt describes enabled Allow Always as intentional permanent scope without an absolute ban", () => {
  const permanent = { optionId: "accept_execpolicy_amendment", kind: "allow_always", name: "Allow Always" };
  const prompt = controlPrompt(
    request([...request().options, permanent]),
    { backendId: "codex" },
    "prompt-nonce",
    true
  );

  assert.doesNotMatch(prompt, /Do NOT choose "Allow Always"/);
  assert.match(prompt, /"Allow Always" is a permanent approval/);
  assert.match(prompt, /only when permanent permission is intentionally required/);
});

test("permission prompt uses the current request names instead of hardcoded legacy labels", () => {
  const prompt = controlPrompt(
    request(currentPermissionOptions()),
    { backendId: "codex" },
    "current-prompt-nonce",
    false
  );

  for (const option of currentPermissionOptions()) {
    assert.match(prompt, new RegExp(`- ${option.name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\n  Return optionId: ${option.optionId}`));
  }
  assert.match(prompt, /Prefer "Allow" for ordinary individual tool calls/);
  assert.match(prompt, /"Allow for This Session" is session-level permission/);
  assert.match(prompt, /Do NOT choose "Allow and Don't Ask Again"/);
  assert.match(prompt, /Use "Decline" \/ "Block Always" when the requested action should not be allowed/);
  assert.doesNotMatch(prompt, /Prefer "Allow Once"/);
});

test("permission prompt does not describe unavailable session or permanent choices", () => {
  const options = request().options.filter((option) => ["allow_once", "reject_once"].includes(option.optionId));
  const prompt = controlPrompt(request(options), { backendId: "codex" }, "prompt-nonce", false);

  assert.doesNotMatch(prompt, /"Allow for Session" is session-level permission/);
  assert.doesNotMatch(prompt, /"Allow Always" is a permanent exec-policy approval/);
  assert.doesNotMatch(prompt, /Do NOT choose "Allow Always"/);
});

test("WebViewer lifecycle attaches exactly one plugin keyboard listener after dom-ready", () => {
  const guest = new FakeGuest(501);
  const webview = new FakeWebview(501, true, "https://chatgpt.com/c/lifecycle-only");
  const leaf = { id: "leaf-lifecycle-only", view: { webview, containerEl: null } };
  const plugin = makePlugin(leaf, new Map([[501, guest]]));
  plugin.bridgeBindingFor = () => null;
  let appearanceCalls = 0;
  plugin.applyAppearance = () => {
    appearanceCalls += 1;
    return true;
  };
  plugin.schedulePromptFocus = () => undefined;

  GptObsidianPlugin.prototype.bindWebview.call(plugin, webview);

  assert.equal(plugin.boundWebviews.size, 1);
  assert.equal(webview.listenerCount("dom-ready"), 1);
  assert.equal(webview.listenerCount("did-navigate"), 1);
  assert.equal(webview.listenerCount("did-navigate-in-page"), 1);
  assert.equal(webview.listenerCount("destroyed"), 1);
  assert.equal(webview.listenerCount("did-attach"), 0);
  assert.equal(webview.listenerCount("focus"), 0);
  assert.equal(webview.listenerCount("blur"), 0);
  assert.equal(guest.listenerCount("before-input-event"), 0);
  assert.equal(guest.listenerCount("input-event"), 0);
  assert.equal(typeof plugin.ensureGuestKeyboardAttached, "undefined");
  assert.equal(typeof plugin.coreWebViewerHasKeyboardListener, "undefined");
  assert.equal(typeof plugin.beginGuestKeyboardProbe, "undefined");

  webview.emit("dom-ready");
  webview.emit("dom-ready");
  webview.emit("did-navigate", {}, webview.url, 200, "OK");
  webview.emit("did-navigate-in-page", {}, webview.url, true);

  assert.equal(appearanceCalls, 4);
  assert.equal(guest.listenerCount("before-input-event"), 1);
  assert.equal(plugin.guestBindings.size, 1);

  plugin.removeWebviewBinding(webview);
  assert.equal(plugin.boundWebviews.size, 0);
  assert.equal(webview.listenerCount("dom-ready"), 0);
  assert.equal(webview.listenerCount("did-navigate"), 0);
  assert.equal(webview.listenerCount("did-navigate-in-page"), 0);
  assert.equal(webview.listenerCount("destroyed"), 0);

  guest.destroyed = true;
  guest.emit("destroyed");
  assert.equal(guest.listenerCount("before-input-event"), 0);
  assert.equal(plugin.guestBindings.size, 0);
});

test("healthy guest keyboard binding is reused without duplicating its listener", () => {
  const { plugin, guest, webview } = keyboardFixture();
  const original = plugin.guestBindings.get(guest.id);

  plugin.attachGuestKeyboard(webview);

  assert.equal(plugin.guestBindings.get(guest.id), original);
  assert.equal(guest.listenerCount("before-input-event"), 1);
  assert.equal(guest.listenerCount("destroyed"), 1);
});

test("guest keyboard listener remains last without duplication and moves behind later foreign listeners", () => {
  const { plugin, guest, webview } = keyboardFixture();
  const binding = plugin.guestBindings.get(guest.id);
  const core = () => undefined;
  const foreign = () => undefined;

  guest.on("before-input-event", core);
  assert.deepEqual(guest.listeners("before-input-event"), [binding.beforeInput, core]);

  plugin.attachGuestKeyboard(webview);
  assert.deepEqual(guest.listeners("before-input-event"), [core, binding.beforeInput]);
  assert.equal(plugin.guestBindings.get(guest.id), binding);

  plugin.attachGuestKeyboard(webview);
  assert.deepEqual(guest.listeners("before-input-event"), [core, binding.beforeInput]);
  assert.equal(guest.listenerCount("before-input-event"), 2);

  guest.on("before-input-event", foreign);
  assert.deepEqual(guest.listeners("before-input-event"), [core, binding.beforeInput, foreign]);

  plugin.attachGuestKeyboard(webview);
  assert.deepEqual(guest.listeners("before-input-event"), [core, foreign, binding.beforeInput]);
  assert.equal(plugin.guestBindings.get(guest.id), binding);
  assert.equal(guest.listeners("before-input-event").filter((listener) => listener === core).length, 1);
  assert.equal(guest.listeners("before-input-event").filter((listener) => listener === foreign).length, 1);
  assert.equal(guest.listeners("before-input-event").filter((listener) => listener === binding.beforeInput).length, 1);
});

test("guest keyboard binding self-heals when its before-input-event listener disappears", () => {
  const { plugin, guest, webview } = keyboardFixture();
  const stale = plugin.guestBindings.get(guest.id);
  guest.removeListener("before-input-event", stale.beforeInput);

  plugin.attachGuestKeyboard(webview);

  const replacement = plugin.guestBindings.get(guest.id);
  assert.notEqual(replacement, stale);
  assert.equal(replacement.webContents, guest);
  assert.equal(guest.listeners("before-input-event").includes(replacement.beforeInput), true);
  assert.equal(guest.listenerCount("before-input-event"), 1);
  assert.equal(guest.listenerCount("destroyed"), 1);
});

test("same guest id with a different webContents instance replaces the stale keyboard binding", () => {
  const { plugin, guest, guests, webview } = keyboardFixture();
  const stale = plugin.guestBindings.get(guest.id);
  const replacementGuest = new FakeGuest(guest.id);
  guests.set(guest.id, replacementGuest);

  plugin.attachGuestKeyboard(webview);

  const replacement = plugin.guestBindings.get(guest.id);
  assert.notEqual(replacement, stale);
  assert.equal(replacement.webContents, replacementGuest);
  assert.equal(guest.listenerCount("before-input-event"), 0);
  assert.equal(guest.listenerCount("destroyed"), 0);
  assert.equal(replacementGuest.listenerCount("before-input-event"), 1);
  assert.equal(replacementGuest.listenerCount("destroyed"), 1);
});

test("stale destroyed callback cannot remove a replacement guest keyboard binding", () => {
  const { plugin, guest, guests, webview } = keyboardFixture();
  const stale = plugin.guestBindings.get(guest.id);
  const replacementGuest = new FakeGuest(guest.id);
  guests.set(guest.id, replacementGuest);
  plugin.attachGuestKeyboard(webview);
  const replacement = plugin.guestBindings.get(guest.id);

  stale.destroyed();

  assert.equal(plugin.guestBindings.get(guest.id), replacement);
  assert.equal(replacementGuest.listenerCount("before-input-event"), 1);
});

test("stale dispose cannot remove a replacement guest keyboard binding", () => {
  const { plugin, guest, guests, webview } = keyboardFixture();
  const stale = plugin.guestBindings.get(guest.id);
  const replacementGuest = new FakeGuest(guest.id);
  guests.set(guest.id, replacementGuest);
  plugin.attachGuestKeyboard(webview);
  const replacement = plugin.guestBindings.get(guest.id);

  stale.dispose();

  assert.equal(plugin.guestBindings.get(guest.id), replacement);
  assert.equal(replacementGuest.listenerCount("before-input-event"), 1);
});

test("destroyed current guest does not retain a keyboard listener or live binding", () => {
  const id = 503;
  const guest = new FakeGuest(id);
  guest.destroyed = true;
  const webview = new FakeWebview(id, true, "https://chatgpt.com/c/destroyed-keyboard");
  const leaf = { id: "leaf-destroyed-keyboard", view: { webview, containerEl: null } };
  const plugin = makePlugin(leaf, new Map([[id, guest]]));
  plugin.boundWebviews.set(webview, { domReadySeen: true });

  plugin.attachGuestKeyboard(webview);

  assert.equal(guest.listenerCount("before-input-event"), 0);
  assert.equal(guest.listenerCount("destroyed"), 0);
  assert.equal(plugin.guestBindings.has(id), false);
});

test("WebViewer activation self-heals a missing listener and replaced guest before dispatch", () => {
  const { plugin, guest, guests, webview, calls } = keyboardFixture();
  const stale = plugin.guestBindings.get(guest.id);
  guest.removeListener("before-input-event", stale.beforeInput);
  const replacementGuest = new FakeGuest(guest.id);
  guests.set(guest.id, replacementGuest);
  plugin.bindWebview = GptObsidianPlugin.prototype.bindWebview.bind(plugin);

  plugin.probeActiveLeaf(plugin.activationSerial);

  const replacement = plugin.guestBindings.get(guest.id);
  assert.notEqual(replacement, stale);
  assert.equal(replacement.webContents, replacementGuest);
  assert.equal(replacementGuest.listenerCount("before-input-event"), 1);
  const event = guestKey(replacementGuest, modifiedKey("ArrowRight", "ArrowRight"));
  assert.deepEqual(calls, ["workspace:next-tab"]);
  assert.equal(event.preventDefaultCalls, 1);
});

test("workspace:next-tab executes exactly once and prevents the handled physical event", () => {
  const { guest, calls } = keyboardFixture();
  const event = guestKey(guest, modifiedKey("ArrowRight", "ArrowRight"));

  assert.deepEqual(calls, ["workspace:next-tab"]);
  assert.equal(event.preventDefaultCalls, 1);
});

test("workspace:previous-tab executes exactly once", () => {
  const { guest, calls } = keyboardFixture({
    commands: ["workspace:previous-tab"],
    hotkeys: {
      "workspace:previous-tab": [{ modifiers: ["Ctrl", "Alt"], key: "ArrowLeft" }]
    }
  });
  const event = guestKey(guest, modifiedKey("ArrowLeft", "ArrowLeft"));

  assert.deepEqual(calls, ["workspace:previous-tab"]);
  assert.equal(event.preventDefaultCalls, 1);
});

test("CORE SUCCESS on Next Tab prevents GPT fallback double dispatch", () => {
  const { plugin, guest, webview, calls } = keyboardFixture();
  let coreDispatches = 0;
  const core = (event) => {
    coreDispatches += 1;
    event.preventDefault();
  };
  guest.on("before-input-event", core);
  plugin.attachGuestKeyboard(webview);

  const binding = plugin.guestBindings.get(guest.id);
  assert.deepEqual(guest.listeners("before-input-event"), [core, binding.beforeInput]);
  const event = guestKey(guest, modifiedKey("ArrowRight", "ArrowRight"));

  assert.equal(coreDispatches, 1);
  assert.deepEqual(calls, []);
  assert.equal(coreDispatches + calls.length, 1);
  assert.equal(event.preventDefaultCalls, 1);
});

test("CORE SUCCESS on Previous Tab prevents GPT fallback double dispatch", () => {
  const { plugin, guest, webview, calls } = keyboardFixture({
    commands: ["workspace:previous-tab"],
    hotkeys: {
      "workspace:previous-tab": [{ modifiers: ["Ctrl", "Alt"], key: "ArrowLeft" }]
    }
  });
  let coreDispatches = 0;
  const core = (event) => {
    coreDispatches += 1;
    event.preventDefault();
  };
  guest.on("before-input-event", core);
  plugin.attachGuestKeyboard(webview);

  const event = guestKey(guest, modifiedKey("ArrowLeft", "ArrowLeft"));

  assert.equal(coreDispatches, 1);
  assert.deepEqual(calls, []);
  assert.equal(coreDispatches + calls.length, 1);
  assert.equal(event.preventDefaultCalls, 1);
});

test("CORE FAILURE keeps GPT fallback active despite a foreign listener", () => {
  const { plugin, guest, webview, calls } = keyboardFixture();
  let coreListenerCalls = 0;
  let coreDispatches = 0;
  const core = () => {
    coreListenerCalls += 1;
  };
  guest.on("before-input-event", core);
  plugin.attachGuestKeyboard(webview);

  const event = guestKey(guest, modifiedKey("ArrowRight", "ArrowRight"));

  assert.equal(coreListenerCalls, 1);
  assert.equal(coreDispatches, 0);
  assert.deepEqual(calls, ["workspace:next-tab"]);
  assert.equal(coreDispatches + calls.length, 1);
  assert.equal(event.preventDefaultCalls, 1);
});

test("preventDefault happens only after a matched command reports handled", () => {
  const sequence = [];
  const { guest, calls } = keyboardFixture({
    execute: () => {
      sequence.push("execute");
      return true;
    }
  });
  const event = {
    preventDefaultCalls: 0,
    preventDefault() {
      this.preventDefaultCalls += 1;
      sequence.push("preventDefault");
    }
  };

  guest.emit("before-input-event", event, modifiedKey("ArrowRight", "ArrowRight"));
  assert.deepEqual(calls, ["workspace:next-tab"]);
  assert.deepEqual(sequence, ["execute", "preventDefault"]);
  assert.equal(event.preventDefaultCalls, 1);
});

test("matched but unhandled command does not prevent the browser event", () => {
  const { guest, calls } = keyboardFixture({ execute: () => false });
  const event = guestKey(guest, modifiedKey("ArrowRight", "ArrowRight"));

  assert.deepEqual(calls, ["workspace:next-tab"]);
  assert.equal(event.preventDefaultCalls, 0);
});

for (const [key, code] of [["a", "KeyA"], ["c", "KeyC"], ["v", "KeyV"], ["x", "KeyX"]]) {
  test(`unmatched Ctrl+${key.toUpperCase()} remains a Chromium shortcut`, () => {
    const { guest, calls } = keyboardFixture();
    const event = guestKey(guest, modifiedKey(key, code, { alt: false }));

    assert.deepEqual(calls, []);
    assert.equal(event.preventDefaultCalls, 0);
  });
}

test("ordinary composer text is not intercepted", () => {
  const { guest, calls } = keyboardFixture();
  const event = guestKey(guest, modifiedKey("ф", "KeyA", { control: false, alt: false }));

  assert.deepEqual(calls, []);
  assert.equal(event.preventDefaultCalls, 0);
});

test("physical event.code preserves hotkey matching under Russian layout", () => {
  const input = modifiedKey("д", "KeyL");
  assert.equal(hotkeyMatchesInput({ modifiers: ["Ctrl", "Alt"], key: "l" }, input), true);

  const { guest, calls } = keyboardFixture({
    hotkeys: {
      "workspace:next-tab": [{ modifiers: ["Ctrl", "Alt"], key: "l" }]
    }
  });
  const event = guestKey(guest, input);

  assert.deepEqual(calls, ["workspace:next-tab"]);
  assert.equal(event.preventDefaultCalls, 1);
});

test("one physical event executes at most one plugin command", () => {
  const shared = [{ modifiers: ["Ctrl", "Alt"], key: "ArrowRight" }];
  const { guest, calls } = keyboardFixture({
    commands: ["workspace:next-tab", "workspace:duplicate-test"],
    hotkeys: {
      "workspace:next-tab": shared,
      "workspace:duplicate-test": shared
    }
  });
  const event = guestKey(guest, modifiedKey("ArrowRight", "ArrowRight"));

  assert.deepEqual(calls, ["workspace:next-tab"]);
  assert.equal(event.preventDefaultCalls, 1);
});

test("WebViewer focus keeps the listener on the owning guest", () => {
  const { guest, webview, calls } = keyboardFixture();
  guest.focused = true;
  webview.emit("focus");

  assert.equal(guest.listenerCount("before-input-event"), 1);
  const event = guestKey(guest, modifiedKey("ArrowRight", "ArrowRight"));
  assert.deepEqual(calls, ["workspace:next-tab"]);
  assert.equal(event.preventDefaultCalls, 1);
});

test("destroyed guest removes its listener and can no longer dispatch", () => {
  const { plugin, guest, calls } = keyboardFixture();
  assert.equal(guest.listenerCount("before-input-event"), 1);

  guest.destroyed = true;
  guest.emit("destroyed");
  assert.equal(guest.listenerCount("before-input-event"), 0);
  assert.equal(plugin.guestBindings.size, 0);

  const event = guestKey(guest, modifiedKey("ArrowRight", "ArrowRight"));
  assert.deepEqual(calls, []);
  assert.equal(event.preventDefaultCalls, 0);
});

test("permission transport resolves guest directly instead of using keyboard bindings", () => {
  const guest = new FakeGuest(502);
  const decoy = new FakeGuest(999);
  const webview = new FakeWebview(502, true, "https://chatgpt.com/c/permission-transport");
  const leaf = { id: "leaf-permission-transport", view: { webview, containerEl: null } };
  const plugin = makePlugin(leaf, new Map([[502, guest]]));
  plugin.guestBindings.set(502, { webContents: decoy });

  assert.equal(plugin.getGuestWebContents(webview), guest);
  assert.equal(guest.listenerCount("before-input-event"), 0);
});
