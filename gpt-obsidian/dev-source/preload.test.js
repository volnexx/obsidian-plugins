"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const sent = [];
const hostListeners = new Map();
const ipcRenderer = {
  sendToHost(channel, payload) { sent.push({ channel, payload }); },
  on(channel, callback) { hostListeners.set(channel, callback); }
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return { ipcRenderer };
  return originalLoad.call(this, request, parent, isMain);
};

const preload = require("./preload.js");

function event(overrides = {}) {
  return {
    code: "KeyK", key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    repeat: false, isComposing: false, prevented: 0, stopped: 0,
    preventDefault() { this.prevented += 1; }, stopPropagation() { this.stopped += 1; }, ...overrides
  };
}

test("C preload keyboard: physical code survives Russian layout", () => {
  assert.deepEqual([...preload.keyCandidates({ code: "BracketLeft", key: "х" })].sort(), ["[", "х"]);
  preload.applyHotkeyConfig({ version: 1, hotkeys: [{ token: "previous", key: "[", ctrl: true, shift: true }] });
  sent.length = 0; const input = event({ code: "BracketLeft", key: "х", ctrlKey: true, shiftKey: true });
  assert.equal(preload.handleKeydown(input), true); assert.equal(input.prevented, 1); assert.equal(input.stopped, 1);
  assert.equal(sent.length, 1); assert.equal(sent[0].payload.code, "BracketLeft");
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
  assert.equal(sent.length, 1);
});

test("B preload security: install is idempotent and exposes no page API", () => {
  const windowListeners = new Map();
  global.window = {
    addEventListener(name, fn) { if (!windowListeners.has(name)) windowListeners.set(name, []); windowListeners.get(name).push(fn); },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, getComputedStyle: () => ({ display: "block", visibility: "visible" })
  };
  global.document = { readyState: "complete", querySelectorAll: () => [] };
  assert.equal(preload.install(), true); assert.equal(preload.install(), false);
  assert.equal(windowListeners.get("keydown").length, 1); assert.equal("gptObsidian" in global.window, false);
  assert.deepEqual([...hostListeners.keys()].sort(), [preload.CHANNELS.BRIDGE_CANCEL, preload.CHANNELS.BRIDGE_REQUEST, preload.CHANNELS.CONFIG, preload.CHANNELS.FOCUS].sort());
});

test("B preload security: invalid bridge request is ignored", async () => {
  sent.length = 0; await preload.startBridgeRequest({ version: 999, requestId: "x", text: "x" });
  assert.equal(sent.length, 0);
});
