"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const sent = [];
const hostListeners = new Map();
const pageApis = new Map();
const ipcRenderer = {
  sendToHost(channel, payload) { sent.push({ channel, payload }); },
  on(channel, callback) { hostListeners.set(channel, callback); }
};
const contextBridge = {
  exposeInMainWorld(key, api) { pageApis.set(key, api); globalThis[key] = api; },
  executeInMainWorld({ func, args }) { return func(...args); }
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return { contextBridge, ipcRenderer };
  return originalLoad.call(this, request, parent, isMain);
};

const preload = require("./preload.js");

function event(overrides = {}) {
  return {
    code: "KeyK", key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    repeat: false, isComposing: false, isTrusted: true, prevented: 0, stopped: 0,
    preventDefault() { this.prevented += 1; }, stopPropagation() { this.stopped += 1; }, ...overrides
  };
}

test("C preload keyboard: physical code survives Russian layout", () => {
  assert.deepEqual([...preload.keyCandidates({ code: "BracketLeft", key: "х" })].sort(), ["[", "х"]);
  preload.applyHotkeyConfig({ version: 1, hotkeys: [{ token: "previous", key: "[", ctrl: true, shift: true }] });
  sent.length = 0; const input = event({ code: "BracketLeft", key: "х", ctrlKey: true, shiftKey: true });
  assert.equal(preload.handleKeydown(input), true); assert.equal(input.prevented, 1); assert.equal(input.stopped, 1);
  const keyboard = sent.filter((message) => message.channel === preload.CHANNELS.KEYBOARD);
  assert.equal(keyboard.length, 1); assert.equal(keyboard[0].payload.code, "BracketLeft");
  const trace = sent.find((message) => message.channel === preload.CHANNELS.DIAGNOSTIC).payload;
  assert.deepEqual({ matched: trace.matched, token: trace.hotkeyToken, sent: trace.keyboardIpcSent }, { matched: true, token: "previous", sent: true });
});

test("C preload keyboard: one event sends exactly one immediate host message", () => {
  preload.applyHotkeyConfig({ version: 1, hotkeys: [{ token: "next", key: "]", ctrl: true, shift: true }] });
  sent.length = 0; const input = event({ code: "BracketRight", key: "ъ", ctrlKey: true, shiftKey: true });
  preload.handleKeydown(input); assert.equal(sent.filter((x) => x.channel === preload.CHANNELS.KEYBOARD).length, 1); assert.equal(input.prevented, 1);
});

test("C preload keyboard: typing, Enter, arrows, and editing shortcuts are untouched", () => {
  preload.applyHotkeyConfig({ version: 1, hotkeys: [{ token: "next", key: "]", ctrl: true, shift: true }] });
  for (const input of [
    event({ code: "KeyA", key: "a" }), event({ code: "Enter", key: "Enter" }),
    event({ code: "Enter", key: "Enter", shiftKey: true }), event({ code: "ArrowLeft", key: "ArrowLeft" }),
    ...["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ"].map((code) => event({ code, key: code.at(-1).toLowerCase(), ctrlKey: true })),
    event({ code: "KeyZ", key: "z", ctrlKey: true, shiftKey: true })
  ]) {
    assert.equal(preload.handleKeydown(input), false); assert.equal(input.prevented, 0);
  }
});

test("C preload keyboard: exact Ctrl/Meta/Alt/Shift modifiers are enforced", () => {
  const descriptor = { token: "x", key: "k", ctrl: true, meta: false, alt: true, shift: false };
  assert.equal(preload.descriptorMatchesEvent(descriptor, event({ ctrlKey: true, altKey: true })), true);
  assert.equal(preload.descriptorMatchesEvent(descriptor, event({ ctrlKey: true, altKey: true, shiftKey: true })), false);
  assert.equal(preload.descriptorMatchesEvent(descriptor, event({ ctrlKey: true, altKey: true, metaKey: true })), false);
});

test("C preload keyboard: repeat and composition never dispatch", () => {
  const descriptor = { token: "x", key: "k", ctrl: false, meta: false, alt: false, shift: false };
  assert.equal(preload.descriptorMatchesEvent(descriptor, event({ repeat: true })), false);
  assert.equal(preload.descriptorMatchesEvent(descriptor, event({ isComposing: true })), false);
});

test("C preload keyboard: synthetic page events cannot dispatch host commands", () => {
  preload.applyHotkeyConfig({ version: 1, hotkeys: [{ token: "x", key: "k", ctrl: true }] });
  sent.length = 0; const input = event({ ctrlKey: true, isTrusted: false });
  assert.equal(preload.handleKeydown(input), false); assert.equal(sent.length, 0); assert.equal(input.prevented, 0);
});

test("C preload keyboard: config validates and deduplicates opaque tokens", () => {
  assert.equal(preload.applyHotkeyConfig({ version: 999, hotkeys: [] }), false);
  assert.equal(preload.applyHotkeyConfig({ version: 1, hotkeys: [null, { token: "same", key: "k" }, { token: "same", key: "x" }] }), true);
  sent.length = 0; preload.handleKeydown(event({ code: "KeyK", key: "k" })); preload.handleKeydown(event({ code: "KeyX", key: "x" }));
  assert.equal(sent.filter((message) => message.channel === preload.CHANNELS.KEYBOARD).length, 1);
});

test("B preload security: install is idempotent and exposes only a narrow write-only fallback", () => {
  const windowListeners = new Map();
  global.window = {
    addEventListener(name, fn) { if (!windowListeners.has(name)) windowListeners.set(name, []); windowListeners.get(name).push(fn); },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, getComputedStyle: () => ({ display: "block", visibility: "visible" })
  };
  const head = { appendChild() {} };
  global.document = { readyState: "complete", querySelectorAll: () => [], getElementById: () => null, createElement: () => ({}), head, documentElement: head };
  global.location = { hostname: "chatgpt.com" };
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { async writeText() {} } } });
  assert.equal(preload.install(), true); assert.equal(preload.install(), false);
  assert.equal(windowListeners.get("keydown").length, 1); assert.equal(windowListeners.get("click").length, 1);
  assert.deepEqual(Object.keys(pageApis.get(preload.CLIPBOARD_API_KEY)), ["fallbackWrite"]);
  assert.deepEqual([...hostListeners.keys()].sort(), [preload.CHANNELS.APPEARANCE, preload.CHANNELS.BRIDGE_CANCEL, preload.CHANNELS.BRIDGE_REQUEST,
    preload.CHANNELS.CLIPBOARD_RESULT, preload.CHANNELS.CONFIG, preload.CHANNELS.FOCUS].sort());
});

test("B appearance: validates palette and replaces one stable style element", () => {
  const styles = new Map(); const head = { appendChild(node) { styles.set(node.id, node); } };
  global.document = { head, documentElement: head, getElementById(id) { return styles.get(id) || null; }, createElement() { return {}; } };
  global.CSS = { supports(property, value) { return property === "color" && !/[;{}]/u.test(value); } };
  global.window = { ...(global.window || {}), getComputedStyle: () => ({ getPropertyValue(name) {
    const text = styles.get("gpt-obsidian-native-appearance")?.textContent || "";
    return new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*:\\s*([^;]+)`, "u").exec(text)?.[1]?.replace(/!important/gu, "").trim() || "";
  } }) };
  const payload = { version: 1, palette: { textColor: "oklch(0.9 0.02 250)", negative: "#abcdef", negativeHover: "rgb(4, 5, 6)" } };
  assert.equal(preload.applyAppearance(payload), true); const first = styles.get("gpt-obsidian-native-appearance");
  assert.match(first.textContent, /--gpt-obsidian-negative: #abcdef/u);
  assert.match(first.textContent, /--text-quaternary:/u); assert.match(first.textContent, /send-button[^}]+svg/isu);
  assert.equal(preload.applyAppearance(payload), true); assert.equal(styles.get("gpt-obsidian-native-appearance"), first);
  assert.deepEqual(preload.applyAppearanceDetailed({ version: 1, palette: { textColor: "red;display:none", negative: "#fff", negativeHover: "#fff" } }).reason, "text-color-invalid");
});

test("B/C diagnostics: CONFIG and APPEARANCE acknowledge real preload results", () => {
  const styles = new Map(); const root = { appendChild(node) { styles.set(node.id, node); } };
  global.document = { head: root, documentElement: root, getElementById(id) { return styles.get(id) || null; }, createElement() { return {}; } };
  global.CSS = { supports(property, value) { return property === "color" && !/[;{}]/u.test(value); } };
  global.window = { ...(global.window || {}), getComputedStyle: () => ({ getPropertyValue: () => "" }) };
  sent.length = 0;
  assert.equal(preload.reportHotkeyConfig({ version: 1, hotkeys: [{ token: "one", key: "]", ctrl: true, shift: true }] }), true);
  const config = sent.find((message) => message.channel === preload.CHANNELS.DIAGNOSTIC && message.payload.area === "hotkeys").payload;
  assert.deepEqual({ received: config.receivedCount, accepted: config.acceptedCount, reason: config.reason }, { received: 1, accepted: 1, reason: "accepted" });
  sent.length = 0;
  assert.equal(preload.reportAppearance({ version: 1, palette: { textColor: "#fff", negative: "#000", negativeHover: "rgb(1, 2, 3)" } }), true);
  const appearance = sent.find((message) => message.channel === preload.CHANNELS.DIAGNOSTIC && message.payload.area === "appearance").payload;
  assert.equal(appearance.applied, true); assert.equal(appearance.styleExists, true); assert.equal(appearance.reason, "applied");
});

test("B clipboard: 100 B, 10 KiB, 100 KiB, Unicode, and markdown preserve exact text", () => {
  for (const text of ["x".repeat(100), "x".repeat(10 * 1024), "x".repeat(100 * 1024), "Привет 🌍\n".repeat(1000), "```js\nconst x = 1;\n```\n**markdown**"]) {
    assert.deepEqual(preload.normalizeClipboardPayload({ text }), { text });
  }
  assert.equal(preload.normalizeClipboardPayload({ text: "x".repeat(preload.CLIPBOARD_MAX_BYTES + 1) }), null);
});

test("B clipboard: native success stays native; exact focus loss alone uses fallback", async () => {
  let nativeCalls = 0; let fallbackText = null;
  const apiKey = "__clipboardTestApi";
  globalThis[apiKey] = { async fallbackWrite({ text }) { fallbackText = text; return true; } };
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { async writeText() { nativeCalls += 1; } } } });
  assert.equal(preload.installClipboardFallbackInPage(apiKey), true);
  await global.navigator.clipboard.writeText("short"); assert.equal(nativeCalls, 1); assert.equal(fallbackText, null);
  const long = `${"длинный 🌍 ".repeat(10000)}\n\n\`\`\`js\nconst ok = true;\n\`\`\``;
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { async writeText() { throw new DOMException("Document is not focused", "NotAllowedError"); } } } });
  assert.equal(preload.installClipboardFallbackInPage(apiKey), true);
  await global.navigator.clipboard.writeText(long); assert.equal(fallbackText, long);
  fallbackText = null;
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { async writeText() { throw new DOMException("Permission denied", "NotAllowedError"); } } } });
  preload.installClipboardFallbackInPage(apiKey);
  await assert.rejects(global.navigator.clipboard.writeText("no"), /Permission denied/u); assert.equal(fallbackText, null);
});

test("B clipboard: host fallback requires a recent trusted Copy-button gesture", async () => {
  sent.length = 0;
  const button = { getAttribute(name) { return name === "aria-label" ? "Copy message" : null; }, innerText: "", textContent: "", closest() { return this; } };
  assert.equal(preload.handleCopyClick({ isTrusted: false, target: button }), false);
  assert.equal(await preload.requestClipboardFallback({ text: "blocked" }), false);
  assert.equal(preload.handleCopyClick({ isTrusted: true, target: button }), true);
  const promise = preload.requestClipboardFallback({ text: "Русский markdown `code`" });
  const request = sent.find((message) => message.channel === preload.CHANNELS.CLIPBOARD_WRITE);
  assert.equal(request.payload.text, "Русский markdown `code`");
  hostListeners.get(preload.CHANNELS.CLIPBOARD_RESULT)(null, { version: 1, requestId: request.payload.requestId, ok: true });
  assert.equal(await promise, true);
});

test("B preload security: invalid bridge request is ignored", async () => {
  sent.length = 0; await preload.startBridgeRequest({ version: 999, requestId: "x", text: "x" });
  assert.equal(sent.length, 0);
});
