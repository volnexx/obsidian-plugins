"use strict";

const { ipcRenderer } = require("electron");

const PROTOCOL_VERSION = 1;
const CHANNELS = Object.freeze({
  CONFIG: "gpt-obsidian:host-config",
  FOCUS: "gpt-obsidian:focus-prompt",
  BRIDGE_REQUEST: "gpt-obsidian:bridge-request",
  BRIDGE_CANCEL: "gpt-obsidian:bridge-cancel",
  READY: "gpt-obsidian:preload-ready",
  KEYBOARD: "gpt-obsidian:keyboard",
  FOCUS_RESULT: "gpt-obsidian:focus-result",
  BRIDGE_SENT: "gpt-obsidian:bridge-sent",
  BRIDGE_RESPONSE: "gpt-obsidian:bridge-response",
  BRIDGE_ERROR: "gpt-obsidian:bridge-error"
});

const CODE_TO_KEY = Object.freeze({
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  Space: "space", Enter: "enter", Tab: "tab", Escape: "escape", Backspace: "backspace",
  Delete: "delete", Insert: "insert", Home: "home", End: "end", PageUp: "pageup",
  PageDown: "pagedown", ArrowUp: "arrowup", ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft", ArrowRight: "arrowright"
});

let hotkeys = [];
let activeBridge = null;
let installed = false;

function normalizeKey(value) {
  if (value == null) return "";
  const key = String(value).toLowerCase();
  if (key === " " || key === "spacebar") return "space";
  if (key === "esc") return "escape";
  if (key === "return") return "enter";
  if (key === "del") return "delete";
  return key;
}

function keyCandidates(input) {
  const result = new Set();
  const direct = normalizeKey(input?.key);
  if (direct) result.add(direct);
  const code = String(input?.code || "");
  const letter = /^Key([A-Z])$/u.exec(code);
  if (letter) result.add(letter[1].toLowerCase());
  const digit = /^Digit([0-9])$/u.exec(code);
  if (digit) result.add(digit[1]);
  const numpad = /^Numpad([0-9])$/u.exec(code);
  if (numpad) result.add(numpad[1]);
  if (CODE_TO_KEY[code]) result.add(normalizeKey(CODE_TO_KEY[code]));
  if (/^F([1-9]|1[0-9]|2[0-4])$/u.test(code)) result.add(code.toLowerCase());
  return result;
}

function validDescriptor(value) {
  if (!value || typeof value !== "object") return null;
  const token = typeof value.token === "string" ? value.token : "";
  const key = normalizeKey(value.key);
  if (!token || token.length > 512 || !key || key.length > 64) return null;
  return {
    token,
    key,
    ctrl: value.ctrl === true,
    meta: value.meta === true,
    alt: value.alt === true,
    shift: value.shift === true
  };
}

function descriptorMatchesEvent(descriptor, event) {
  if (!descriptor || !event || event.isComposing || event.repeat) return false;
  if (Boolean(event.ctrlKey) !== descriptor.ctrl) return false;
  if (Boolean(event.metaKey) !== descriptor.meta) return false;
  if (Boolean(event.altKey) !== descriptor.alt) return false;
  if (Boolean(event.shiftKey) !== descriptor.shift) return false;
  return keyCandidates(event).has(descriptor.key);
}

function send(channel, payload) {
  try { ipcRenderer.sendToHost(channel, payload); } catch (_) {}
}

function handleKeydown(event) {
  if (event?.isTrusted === false) return false;
  const descriptor = hotkeys.find((candidate) => descriptorMatchesEvent(candidate, event));
  if (!descriptor) return false;
  event.preventDefault();
  event.stopPropagation?.();
  send(CHANNELS.KEYBOARD, {
    version: PROTOCOL_VERSION,
    token: descriptor.token,
    code: String(event.code || "").slice(0, 64),
    key: String(event.key || "").slice(0, 64),
    ctrl: Boolean(event.ctrlKey),
    meta: Boolean(event.metaKey),
    alt: Boolean(event.altKey),
    shift: Boolean(event.shiftKey)
  });
  return true;
}

function visible(element) {
  if (!element?.isConnected) return false;
  try {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect?.();
    return !rect || rect.width > 0 && rect.height > 0;
  } catch (_) {
    return true;
  }
}

function findPrompt() {
  const selectors = [
    "#prompt-textarea",
    "[data-testid=\"prompt-textarea\"]",
    "textarea[placeholder]",
    "textarea",
    "[contenteditable=\"true\"][data-virtualkeyboard]"
  ];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true") {
        return element;
      }
    }
  }
  return null;
}

function focusPrompt() {
  const overlay = [...document.querySelectorAll("[role=\"dialog\"], [role=\"menu\"]")].some(visible);
  if (overlay) return false;
  const input = findPrompt();
  if (!input) return false;
  input.focus({ preventScroll: true });
  if (input.isContentEditable) {
    const selection = window.getSelection?.();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } else if (typeof input.setSelectionRange === "function") {
    const end = String(input.value ?? "").length;
    input.setSelectionRange(end, end);
  }
  return document.activeElement === input || input.contains?.(document.activeElement);
}

function promptText(input) {
  return String(input?.isContentEditable ? input.textContent || "" : input?.value || "").trim();
}

function setPromptText(input, text) {
  if (!input) return false;
  if (promptText(input)) return false;
  input.focus({ preventScroll: true });
  if (input.isContentEditable) {
    input.textContent = text;
  } else {
    const prototype = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set ||
      Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement?.prototype || {}, "value")?.set;
    if (setter) setter.call(input, text);
    else input.value = text;
  }
  const event = typeof InputEvent === "function"
    ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
    : new Event("input", { bubbles: true });
  input.dispatchEvent(event);
  return true;
}

function identity(node) {
  const owner = node?.closest?.("[data-message-id],[data-testid^=\"conversation-turn-\"]") || node;
  return owner?.getAttribute?.("data-message-id") || owner?.id || owner?.getAttribute?.("data-testid") || null;
}

function readConversationState() {
  const assistants = [...document.querySelectorAll("[data-message-author-role=\"assistant\"]")];
  const users = [...document.querySelectorAll("[data-message-author-role=\"user\"]")];
  const lastAssistant = assistants.at(-1) || null;
  const lastUser = users.at(-1) || null;
  const generating = Boolean(document.querySelector([
    "[data-testid=\"stop-button\"]",
    "[data-testid=\"composer-stop-button\"]",
    "button[data-testid*=\"stop\" i]",
    "[data-is-streaming=\"true\"]",
    ".result-streaming",
    "[aria-busy=\"true\"] [data-message-author-role=\"assistant\"]"
  ].join(",")));
  return {
    generating,
    assistantCount: assistants.length,
    lastAssistantId: identity(lastAssistant),
    lastAssistantText: String(lastAssistant?.innerText || lastAssistant?.textContent || ""),
    userCount: users.length,
    lastUserId: identity(lastUser),
    lastUserText: String(lastUser?.innerText || lastUser?.textContent || "")
  };
}

function findSendButton() {
  const selector = [
    "button[data-testid=\"send-button\"]",
    "button[data-testid=\"composer-submit-button\"]",
    "button#composer-submit-button",
    "button[type=\"submit\"]",
    "button[aria-label*=\"Send\" i]",
    "button[aria-label*=\"Отправ\" i]"
  ].join(",");
  return [...document.querySelectorAll(selector)].find((button) =>
    visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true"
  ) || null;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clearBridge(requestId = null) {
  if (!activeBridge || requestId && activeBridge.requestId !== requestId) return;
  if (activeBridge.pollTimer != null) window.clearInterval(activeBridge.pollTimer);
  activeBridge = null;
}

async function sendBridgePrompt(active) {
  const input = findPrompt();
  if (!input) throw new Error("ChatGPT prompt unavailable");
  if (!setPromptText(input, active.text)) throw new Error("ChatGPT prompt contains a draft");
  let button = null;
  for (let attempt = 0; attempt < 80 && !button; attempt += 1) {
    button = findSendButton();
    if (!button) await delay(50);
  }
  if (!button) throw new Error("ChatGPT send button unavailable");
  button.click();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = readConversationState();
    if (state.lastUserText.includes(active.requestId)) {
      active.sentUserId = state.lastUserId;
      send(CHANNELS.BRIDGE_SENT, {
        version: PROTOCOL_VERSION,
        requestId: active.requestId,
        userMessageId: active.sentUserId,
        userCount: state.userCount
      });
      return;
    }
    await delay(100);
  }
  throw new Error("ChatGPT did not accept the permission prompt");
}

function pollBridge(active) {
  if (activeBridge !== active || active.settled) return;
  const state = readConversationState();
  const newAssistant = active.baselineAssistantId
    ? Boolean(state.lastAssistantId && state.lastAssistantId !== active.baselineAssistantId)
    : state.assistantCount > active.baselineAssistantCount;
  if (!newAssistant) return;
  if (active.sentUserId && state.lastUserId && state.lastUserId !== active.sentUserId) return;
  if (state.lastAssistantText !== active.lastText) {
    active.lastText = state.lastAssistantText;
    active.changedAt = Date.now();
    return;
  }
  if (state.generating || !state.lastAssistantText || Date.now() - active.changedAt < 1400) return;
  active.settled = true;
  send(CHANNELS.BRIDGE_RESPONSE, {
    version: PROTOCOL_VERSION,
    requestId: active.requestId,
    text: state.lastAssistantText.slice(0, 20000)
  });
  clearBridge(active.requestId);
}

async function startBridgeRequest(payload) {
  if (!payload || payload.version !== PROTOCOL_VERSION) return;
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  if (!requestId || requestId.length > 512 || !text || text.length > 16000) return;
  if (activeBridge) {
    send(CHANNELS.BRIDGE_ERROR, { version: PROTOCOL_VERSION, requestId, error: "bridge busy" });
    return;
  }
  const baseline = readConversationState();
  const active = activeBridge = {
    requestId,
    text,
    baselineAssistantId: baseline.lastAssistantId,
    baselineAssistantCount: baseline.assistantCount,
    sentUserId: null,
    lastText: "",
    changedAt: Date.now(),
    settled: false,
    pollTimer: null
  };
  try {
    await sendBridgePrompt(active);
    if (activeBridge !== active) return;
    active.pollTimer = window.setInterval(() => pollBridge(active), 400);
    pollBridge(active);
  } catch (error) {
    if (activeBridge === active) {
      send(CHANNELS.BRIDGE_ERROR, {
        version: PROTOCOL_VERSION,
        requestId,
        error: String(error?.message || error).slice(0, 300)
      });
      clearBridge(requestId);
    }
  }
}

function applyHotkeyConfig(payload) {
  if (!payload || payload.version !== PROTOCOL_VERSION || !Array.isArray(payload.hotkeys)) return false;
  const next = payload.hotkeys.slice(0, 2000).map(validDescriptor).filter(Boolean);
  const tokens = new Set();
  hotkeys = next.filter((descriptor) => {
    if (tokens.has(descriptor.token)) return false;
    tokens.add(descriptor.token);
    return true;
  });
  return true;
}

function install() {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return false;
  installed = true;
  window.addEventListener("keydown", handleKeydown, true);
  ipcRenderer.on(CHANNELS.CONFIG, (_event, payload) => applyHotkeyConfig(payload));
  ipcRenderer.on(CHANNELS.FOCUS, (_event, payload) => {
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    const focused = focusPrompt();
    send(CHANNELS.FOCUS_RESULT, { version: PROTOCOL_VERSION, requestId, focused });
  });
  ipcRenderer.on(CHANNELS.BRIDGE_REQUEST, (_event, payload) => void startBridgeRequest(payload));
  ipcRenderer.on(CHANNELS.BRIDGE_CANCEL, (_event, payload) => clearBridge(payload?.requestId || null));
  const ready = () => send(CHANNELS.READY, { version: PROTOCOL_VERSION });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
  return true;
}

if (typeof window !== "undefined" && typeof document !== "undefined") install();

module.exports = {
  CHANNELS,
  PROTOCOL_VERSION,
  applyHotkeyConfig,
  clearBridge,
  descriptorMatchesEvent,
  focusPrompt,
  handleKeydown,
  install,
  keyCandidates,
  normalizeKey,
  readConversationState,
  startBridgeRequest,
  validDescriptor
};
