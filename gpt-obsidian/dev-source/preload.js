"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const PROTOCOL_VERSION = 1;
const CLIPBOARD_API_KEY = "__gptObsidianClipboard";
const CLIPBOARD_MAX_BYTES = 4 * 1024 * 1024;
const CLIPBOARD_GESTURE_WINDOW_MS = 15000;
const CLIPBOARD_RESULT_TIMEOUT_MS = 10000;
const CHANNELS = Object.freeze({
  CONFIG: "gpt-obsidian:host-config",
  APPEARANCE: "gpt-obsidian:appearance",
  FOCUS: "gpt-obsidian:focus-prompt",
  BRIDGE_REQUEST: "gpt-obsidian:bridge-request",
  BRIDGE_CANCEL: "gpt-obsidian:bridge-cancel",
  READY: "gpt-obsidian:preload-ready",
  KEYBOARD: "gpt-obsidian:keyboard",
  FOCUS_RESULT: "gpt-obsidian:focus-result",
  BRIDGE_SENT: "gpt-obsidian:bridge-sent",
  BRIDGE_RESPONSE: "gpt-obsidian:bridge-response",
  BRIDGE_ERROR: "gpt-obsidian:bridge-error",
  CLIPBOARD_WRITE: "gpt-obsidian:clipboard-write",
  CLIPBOARD_RESULT: "gpt-obsidian:clipboard-result"
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
let clipboardGestureUntil = 0;
let clipboardRequestSerial = 0;
const pendingClipboardWrites = new Map();

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function normalizeClipboardPayload(value) {
  if (!value || typeof value !== "object" || typeof value.text !== "string") return null;
  if (utf8ByteLength(value.text) > CLIPBOARD_MAX_BYTES) return null;
  return { text: value.text };
}

function normalizeCssColor(value) {
  const color = typeof value === "string" ? value.trim() : "";
  if (!color || color.length > 80 || !/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/iu.test(color)) return null;
  return color;
}

function applyAppearance(payload) {
  if (payload?.version !== PROTOCOL_VERSION) return false;
  const textColor = normalizeCssColor(payload?.palette?.textColor);
  const negative = normalizeCssColor(payload?.palette?.negative);
  const negativeHover = normalizeCssColor(payload?.palette?.negativeHover);
  if (!textColor || !negative || !negativeHover) return false;
  const root = document.head || document.documentElement;
  if (!root) return false;
  const styleId = "gpt-obsidian-native-appearance";
  let style = document.getElementById?.(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    root.appendChild(style);
  }
  style.textContent = `
:root {
  --gpt-obsidian-text-color: ${textColor};
  --gpt-obsidian-negative: ${negative};
  --gpt-obsidian-negative-hover: ${negativeHover};
  --text-primary: ${textColor} !important;
  --text-secondary: ${textColor} !important;
  --text-tertiary: ${textColor} !important;
  --text-placeholder: ${textColor} !important;
  --composer-blue-bg: ${negative} !important;
  --composer-blue-hover: ${negativeHover} !important;
}
body :where(
  div, p, span, a, button, label, textarea, input,
  [contenteditable="true"], [role="button"], [role="menuitem"],
  [role="option"], [role="tab"], h1, h2, h3, h4, h5, h6,
  li, dt, dd, th, td, blockquote, figcaption, small, strong, em
):not(pre):not(pre *):not(code):not(code *) {
  color: var(--gpt-obsidian-text-color) !important;
}
#prompt-textarea, [data-testid="prompt-textarea"], textarea, input {
  color: var(--gpt-obsidian-text-color) !important;
  caret-color: var(--gpt-obsidian-text-color) !important;
}
#prompt-textarea::placeholder, [data-testid="prompt-textarea"]::placeholder,
textarea::placeholder, input::placeholder, [data-placeholder]::before {
  color: var(--gpt-obsidian-text-color) !important;
}
[data-message-author-role="user"] .user-message-bubble-color,
[data-message-author-role="user"] [class*="user-message-bubble"],
[data-message-author-role="user"] [class*="bg-token-message-surface"] {
  background-color: var(--gpt-obsidian-negative) !important;
}
button[data-testid="send-button"], [data-testid="send-button"] {
  background-color: var(--gpt-obsidian-negative) !important;
  border-color: var(--gpt-obsidian-negative) !important;
  color: var(--gpt-obsidian-text-color) !important;
}
button[data-testid="send-button"]:hover, [data-testid="send-button"]:hover {
  background-color: var(--gpt-obsidian-negative-hover) !important;
  border-color: var(--gpt-obsidian-negative-hover) !important;
}`;
  return true;
}

function isCopyButtonEvent(event) {
  if (event?.isTrusted !== true) return false;
  let target = event.target;
  if (target?.nodeType === 3) target = target.parentElement;
  const button = target?.closest?.("button");
  if (!button) return false;
  const label = [button.getAttribute?.("aria-label"), button.getAttribute?.("title"), button.innerText, button.textContent]
    .filter((part) => typeof part === "string").join(" ").toLocaleLowerCase();
  return /\bcopy\b|копир|скопир/u.test(label);
}

function handleCopyClick(event) {
  if (!isCopyButtonEvent(event)) return false;
  clipboardGestureUntil = Date.now() + CLIPBOARD_GESTURE_WINDOW_MS;
  return true;
}

function handleClipboardResult(payload) {
  if (payload?.version !== PROTOCOL_VERSION || typeof payload.requestId !== "string") return false;
  const pending = pendingClipboardWrites.get(payload.requestId);
  if (!pending) return false;
  pendingClipboardWrites.delete(payload.requestId);
  window.clearTimeout(pending.timer);
  pending.resolve(payload.ok === true);
  return true;
}

function requestClipboardFallback(value) {
  const payload = normalizeClipboardPayload(value);
  if (!payload || Date.now() > clipboardGestureUntil) return Promise.resolve(false);
  clipboardGestureUntil = 0;
  const requestId = `clipboard-${Date.now()}-${++clipboardRequestSerial}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pendingClipboardWrites.delete(requestId);
      resolve(false);
    }, CLIPBOARD_RESULT_TIMEOUT_MS);
    pendingClipboardWrites.set(requestId, { resolve, timer });
    send(CHANNELS.CLIPBOARD_WRITE, { version: PROTOCOL_VERSION, requestId, text: payload.text });
  });
}

function installClipboardFallbackInPage(apiKey) {
  const clipboard = globalThis.navigator?.clipboard;
  const bridge = globalThis[apiKey];
  if (!clipboard || typeof bridge?.fallbackWrite !== "function") return false;
  const marker = "__gptObsidianFocusFallbackInstalled";
  if (clipboard[marker] === true) return false;
  const originalWriteText = typeof clipboard.writeText === "function" ? clipboard.writeText.bind(clipboard) : null;
  const originalWrite = typeof clipboard.write === "function" ? clipboard.write.bind(clipboard) : null;
  const isFocusError = (error) => /document is not focused/iu.test(String(error?.message || error || ""));
  const fallback = async (error, text) => {
    if (!isFocusError(error) || typeof text !== "string") throw error;
    if (await bridge.fallbackWrite({ text }) !== true) throw error;
  };
  if (originalWriteText) {
    Object.defineProperty(clipboard, "writeText", { configurable: true, writable: true, value: async (text) => {
      try { return await originalWriteText(text); }
      catch (error) { return fallback(error, String(text)); }
    } });
  }
  if (originalWrite) {
    Object.defineProperty(clipboard, "write", { configurable: true, writable: true, value: async (items) => {
      try { return await originalWrite(items); }
      catch (error) {
        if (!isFocusError(error)) throw error;
        const item = Array.isArray(items) ? items[0] : null;
        if (!item?.types?.includes?.("text/plain") || typeof item.getType !== "function") throw error;
        const blob = await item.getType("text/plain");
        return fallback(error, await blob.text());
      }
    } });
  }
  Object.defineProperty(clipboard, marker, { configurable: false, enumerable: false, value: true });
  return Boolean(originalWriteText || originalWrite);
}

function installClipboardPageBridge() {
  if (!/^(chatgpt\.com|chat\.openai\.com)$/iu.test(String(globalThis.location?.hostname || ""))) return false;
  if (typeof contextBridge?.exposeInMainWorld !== "function" || typeof contextBridge?.executeInMainWorld !== "function") return false;
  try {
    contextBridge.exposeInMainWorld(CLIPBOARD_API_KEY, { fallbackWrite: (payload) => requestClipboardFallback(payload) });
    return contextBridge.executeInMainWorld({ func: installClipboardFallbackInPage, args: [CLIPBOARD_API_KEY] }) === true;
  } catch (_) {
    return false;
  }
}

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
  window.addEventListener("click", handleCopyClick, true);
  installClipboardPageBridge();
  ipcRenderer.on(CHANNELS.CONFIG, (_event, payload) => applyHotkeyConfig(payload));
  ipcRenderer.on(CHANNELS.APPEARANCE, (_event, payload) => applyAppearance(payload));
  ipcRenderer.on(CHANNELS.FOCUS, (_event, payload) => {
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    const focused = focusPrompt();
    send(CHANNELS.FOCUS_RESULT, { version: PROTOCOL_VERSION, requestId, focused });
  });
  ipcRenderer.on(CHANNELS.BRIDGE_REQUEST, (_event, payload) => void startBridgeRequest(payload));
  ipcRenderer.on(CHANNELS.BRIDGE_CANCEL, (_event, payload) => clearBridge(payload?.requestId || null));
  ipcRenderer.on(CHANNELS.CLIPBOARD_RESULT, (_event, payload) => handleClipboardResult(payload));
  send(CHANNELS.READY, { version: PROTOCOL_VERSION, ok: true });
  return true;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  try { install(); }
  catch (error) {
    const message = String(error?.message || error || "preload startup failed").slice(0, 300);
    try { console.error("[GPT Obsidian preload] startup failed", error); } catch (_) {}
    send(CHANNELS.READY, { version: PROTOCOL_VERSION, ok: false, error: message });
  }
}

const TEST_API = {
  CLIPBOARD_API_KEY,
  CLIPBOARD_MAX_BYTES,
  CHANNELS,
  PROTOCOL_VERSION,
  applyAppearance,
  applyHotkeyConfig,
  clearBridge,
  descriptorMatchesEvent,
  focusPrompt,
  handleClipboardResult,
  handleCopyClick,
  handleKeydown,
  install,
  installClipboardFallbackInPage,
  installClipboardPageBridge,
  isCopyButtonEvent,
  keyCandidates,
  normalizeClipboardPayload,
  normalizeKey,
  readConversationState,
  requestClipboardFallback,
  startBridgeRequest,
  utf8ByteLength,
  validDescriptor
};

// Electron sandboxed preload scripts do not expose CommonJS globals. Node tests do.
if (typeof module !== "undefined" && module?.exports) module.exports = TEST_API;
