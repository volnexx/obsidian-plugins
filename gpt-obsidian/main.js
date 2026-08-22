const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
const ACTIVATION_PROBE_DELAYS = [0, 120, 400, 900];
const PROMPT_FOCUS_DELAYS = [30, 160];
const DEFAULT_SETTINGS = {
  textColorMode: "theme"
};

const CODE_TO_KEY = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "space",
  Enter: "enter",
  Tab: "tab",
  Escape: "escape",
  Backspace: "backspace",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright"
};

const FOCUS_PROMPT_SCRIPT = String.raw`(() => {
  const visible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const blockingOverlay = Array.from(
    document.querySelectorAll('[role="dialog"], [role="menu"]')
  ).some(visible);
  if (blockingOverlay) return false;

  const candidates = [
    document.querySelector('#prompt-textarea'),
    document.querySelector('[data-testid="prompt-textarea"]'),
    ...document.querySelectorAll('textarea')
  ];

  const input = candidates.find((el) => {
    if (!visible(el)) return false;
    if (el.disabled) return false;
    return el.getAttribute('aria-disabled') !== 'true';
  });

  if (!input) return false;

  input.focus({ preventScroll: true });

  if (input.isContentEditable) {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } else if (typeof input.setSelectionRange === 'function') {
    const end = String(input.value ?? '').length;
    input.setSelectionRange(end, end);
  }

  return document.activeElement === input || input.contains(document.activeElement);
})()`;

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
  const direct = normalizeKey(input.key);
  if (direct) result.add(direct);

  const code = String(input.code || "");
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) result.add(letter[1].toLowerCase());

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) result.add(digit[1]);

  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) result.add(numpad[1]);

  const mapped = CODE_TO_KEY[code];
  if (mapped) result.add(normalizeKey(mapped));

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    result.add(code.toLowerCase());
  }

  return result;
}

function isMacPlatform() {
  return process.platform === "darwin";
}

function hotkeyMatchesInput(hotkey, input) {
  if (!hotkey || !hotkey.key) return false;

  const expected = { ctrl: false, meta: false, alt: false, shift: false };

  for (const rawModifier of hotkey.modifiers || []) {
    const modifier = String(rawModifier).toLowerCase();
    if (modifier === "mod") {
      if (isMacPlatform()) expected.meta = true;
      else expected.ctrl = true;
    } else if (modifier === "ctrl" || modifier === "control") {
      expected.ctrl = true;
    } else if (modifier === "meta" || modifier === "cmd" || modifier === "command") {
      expected.meta = true;
    } else if (modifier === "alt" || modifier === "option") {
      expected.alt = true;
    } else if (modifier === "shift") {
      expected.shift = true;
    }
  }

  if (Boolean(input.control) !== expected.ctrl) return false;
  if (Boolean(input.meta) !== expected.meta) return false;
  if (Boolean(input.alt) !== expected.alt) return false;
  if (Boolean(input.shift) !== expected.shift) return false;

  return keyCandidates(input).has(normalizeKey(hotkey.key));
}

function isPotentialObsidianShortcut(input) {
  if (!input || input.type !== "keyDown" || input.isComposing) return false;
  if (input.control || input.meta || input.alt) return true;

  const key = normalizeKey(input.key);
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return true;
  return ["escape", "insert", "delete", "home", "end", "pageup", "pagedown"].includes(key);
}

function isChatGptUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    return CHATGPT_HOSTS.has(host) || host.endsWith(".chatgpt.com");
  } catch (_) {
    return false;
  }
}

function parseRgb(color) {
  const value = String(color || "").trim();

  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) {
    return [
      Math.max(0, Math.min(255, Number(rgb[1]))),
      Math.max(0, Math.min(255, Number(rgb[2]))),
      Math.max(0, Math.min(255, Number(rgb[3])))
    ];
  }

  const hex6 = value.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const hex3 = value.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    return hex3[1].split("").map((x) => parseInt(x + x, 16));
  }

  return [127, 109, 242];
}

function rgbString(rgb) {
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

function invertColor(color) {
  const [r, g, b] = parseRgb(color);
  return rgbString([255 - r, 255 - g, 255 - b]);
}

function mixColor(a, b, amount) {
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  return rgbString(ca.map((v, i) => v * (1 - amount) + cb[i] * amount));
}

function sanitizeCssColor(value) {
  const color = String(value || "").trim();
  if (!color) return "#ffffff";

  try {
    if (typeof CSS === "undefined" || CSS.supports("color", color)) {
      return color;
    }
  } catch (_) {}

  return "#ffffff";
}

function buildAppearanceScript(palette) {
  const textColor = sanitizeCssColor(palette.textColor);
  const negative = sanitizeCssColor(palette.negative);
  const negativeHover = sanitizeCssColor(palette.negativeHover);

  const css = `
:root {
  --gpt-obsidian-text-color: ${textColor};
  --gpt-obsidian-negative: ${negative};
  --gpt-obsidian-negative-hover: ${negativeHover};

  --text-primary: ${textColor} !important;
  --text-secondary: ${textColor} !important;
  --text-tertiary: ${textColor} !important;
  --text-quaternary: ${textColor} !important;
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

#prompt-textarea,
[data-testid="prompt-textarea"],
textarea,
input {
  color: var(--gpt-obsidian-text-color) !important;
  caret-color: var(--gpt-obsidian-text-color) !important;
}

#prompt-textarea::placeholder,
[data-testid="prompt-textarea"]::placeholder,
textarea::placeholder,
input::placeholder,
[data-placeholder]::before {
  color: var(--gpt-obsidian-text-color) !important;
  opacity: 0.72 !important;
}

/* User message bubble: replace ChatGPT blue with the negative theme accent. */
[data-message-author-role="user"] .user-message-bubble-color,
[data-message-author-role="user"] [class*="user-message-bubble"],
[data-message-author-role="user"] [class*="bg-token-message-surface"] {
  background-color: var(--gpt-obsidian-negative) !important;
}

/* Send button: use the same negative theme accent. */
button[data-testid="send-button"],
[data-testid="send-button"] {
  background-color: var(--gpt-obsidian-negative) !important;
  border-color: var(--gpt-obsidian-negative) !important;
  color: var(--gpt-obsidian-text-color) !important;
}

button[data-testid="send-button"]:hover,
[data-testid="send-button"]:hover {
  background-color: var(--gpt-obsidian-negative-hover) !important;
  border-color: var(--gpt-obsidian-negative-hover) !important;
}

button[data-testid="send-button"] svg,
[data-testid="send-button"] svg {
  color: var(--gpt-obsidian-text-color) !important;
  fill: currentColor !important;
  stroke: currentColor !important;
}
`;

  return `(() => {
    const styleId = "gpt-obsidian-appearance";
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = ${JSON.stringify(css)};
    return true;
  })()`;
}

class GptObsidianSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Цвет текста ChatGPT")
      .setDesc("Белый или основной цвет текста текущей темы Obsidian.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("white", "Белый")
          .addOption("theme", "Цвет текста темы Obsidian")
          .setValue(this.plugin.settings.textColorMode)
          .onChange(async (value) => {
            this.plugin.settings.textColorMode = value === "white" ? "white" : "theme";
            await this.plugin.saveSettings();
            await this.plugin.applyAppearanceToAllChatGptWebviews();
          });
      });

    new Setting(containerEl)
      .setName("Цвет твоих сообщений и кнопки отправки")
      .setDesc("Автоматически используется отрицательный цвет акцента темы. Например: голубой → оранжевый.");
  }
}

class GptObsidianPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.activationSerial = 0;
    this.boundWebviews = new Map();
    this.guestBindings = new Map();
    this.remote = null;
    this.warnedRemote = false;
    this.themeRefreshTimer = null;
    this.themeObserver = null;

    this.addSettingTab(new GptObsidianSettingTab(this.app, this));

    try {
      this.remote = require("@electron/remote");
    } catch (error) {
      this.warnRemote(error);
    }

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.handleActivation())
    );

    this.registerEvent(
      this.app.workspace.on("css-change", () => this.scheduleThemeRefresh())
    );

    this.installThemeObserver();

    this.app.workspace.onLayoutReady(() => {
      this.handleActivation();
      this.applyAppearanceToAllChatGptWebviews();
    });
  }

  onunload() {
    this.activationSerial += 1;

    if (this.themeRefreshTimer != null) {
      window.clearTimeout(this.themeRefreshTimer);
      this.themeRefreshTimer = null;
    }

    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }

    for (const [webview, binding] of this.boundWebviews) {
      try {
        webview.removeEventListener("dom-ready", binding.domReady);
        webview.removeEventListener("did-navigate", binding.navigated);
        webview.removeEventListener("did-navigate-in-page", binding.navigated);
      } catch (_) {}
    }
    this.boundWebviews.clear();

    for (const [id, binding] of this.guestBindings) {
      try {
        binding.webContents.removeListener("before-input-event", binding.beforeInput);
        binding.webContents.removeListener("destroyed", binding.destroyed);
      } catch (_) {}
      this.guestBindings.delete(id);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  installThemeObserver() {
    if (typeof MutationObserver === "undefined") return;

    this.themeObserver = new MutationObserver(() => this.scheduleThemeRefresh());
    const options = { attributes: true, attributeFilter: ["class", "style"] };

    try {
      this.themeObserver.observe(document.documentElement, options);
      if (document.body) this.themeObserver.observe(document.body, options);
    } catch (_) {}
  }

  scheduleThemeRefresh() {
    if (this.themeRefreshTimer != null) {
      window.clearTimeout(this.themeRefreshTimer);
    }

    this.themeRefreshTimer = window.setTimeout(() => {
      this.themeRefreshTimer = null;
      this.applyAppearanceToAllChatGptWebviews();
    }, 80);
  }

  resolveThemeColor(value, fallback) {
    const raw = String(value || "").trim();
    if (!raw) return fallback;

    const host = document.body || document.documentElement;
    if (!host) return raw || fallback;

    const probe = document.createElement("span");
    probe.style.position = "fixed";
    probe.style.pointerEvents = "none";
    probe.style.opacity = "0";
    probe.style.color = raw;

    try {
      host.appendChild(probe);
      const resolved = window.getComputedStyle(probe).color;
      probe.remove();
      return resolved || raw || fallback;
    } catch (_) {
      try { probe.remove(); } catch (_) {}
      return raw || fallback;
    }
  }

  getThemePalette() {
    const target = document.body || document.documentElement;
    const fallbackAccent = "rgb(59, 130, 246)";
    const fallbackText = "#ffffff";

    if (!target) {
      const negative = invertColor(fallbackAccent);
      return {
        textColor: this.settings.textColorMode === "white" ? "#ffffff" : fallbackText,
        negative,
        negativeHover: mixColor(negative, "#ffffff", 0.12)
      };
    }

    try {
      const styles = window.getComputedStyle(target);
      const accentRaw =
        styles.getPropertyValue("--interactive-accent").trim() ||
        styles.getPropertyValue("--color-accent").trim() ||
        fallbackAccent;

      const textRaw =
        styles.getPropertyValue("--text-normal").trim() ||
        styles.color ||
        fallbackText;

      const accent = this.resolveThemeColor(accentRaw, fallbackAccent);
      const text = this.resolveThemeColor(textRaw, fallbackText);
      const negative = invertColor(accent);

      return {
        textColor: this.settings.textColorMode === "white" ? "#ffffff" : text,
        negative,
        negativeHover: mixColor(negative, "#ffffff", 0.12)
      };
    } catch (_) {
      const negative = invertColor(fallbackAccent);
      return {
        textColor: this.settings.textColorMode === "white" ? "#ffffff" : fallbackText,
        negative,
        negativeHover: mixColor(negative, "#ffffff", 0.12)
      };
    }
  }

  collectChatGptWebviews() {
    const webviews = new Set(this.boundWebviews.keys());

    if (typeof this.app.workspace.iterateAllLeaves === "function") {
      try {
        this.app.workspace.iterateAllLeaves((leaf) => {
          const webview = this.getWebview(leaf);
          if (webview) webviews.add(webview);
        });
      } catch (_) {}
    }

    try {
      for (const webview of document.querySelectorAll("webview")) {
        webviews.add(webview);
      }
    } catch (_) {}

    return [...webviews].filter((webview) => this.isChatGptWebview(webview));
  }

  async applyAppearanceToAllChatGptWebviews() {
    const palette = this.getThemePalette();

    for (const webview of this.collectChatGptWebviews()) {
      this.bindWebview(webview);
      await this.applyAppearance(webview, palette);
    }
  }

  async applyAppearance(webview, palette = null) {
    if (!webview || !this.isChatGptWebview(webview)) return;
    if (typeof webview.executeJavaScript !== "function") return;

    try {
      await webview.executeJavaScript(
        buildAppearanceScript(palette || this.getThemePalette()),
        true
      );
    } catch (_) {
      // Navigation may replace the guest document while styles are applied.
    }
  }

  handleActivation() {
    const serial = ++this.activationSerial;

    for (const delay of ACTIVATION_PROBE_DELAYS) {
      window.setTimeout(() => {
        if (serial !== this.activationSerial) return;
        this.probeActiveLeaf(serial);
      }, delay);
    }
  }

  probeActiveLeaf(serial) {
    if (serial !== this.activationSerial) return;

    const leaf = this.app.workspace.activeLeaf;
    const webview = this.getWebview(leaf);
    if (!webview || !this.isChatGptWebview(webview)) return;

    this.bindWebview(webview);
    this.applyAppearance(webview);
    this.schedulePromptFocus(webview, serial);
  }

  getWebview(leaf) {
    const view = leaf && leaf.view;
    if (!view) return null;

    for (const candidate of [view.webview, view.webviewEl]) {
      if (candidate && typeof candidate === "object") return candidate;
    }

    const root = view.containerEl || leaf?.containerEl;
    if (root && typeof root.querySelector === "function") {
      return root.querySelector("webview");
    }

    return null;
  }

  getWebviewUrl(webview) {
    try {
      if (typeof webview.getURL === "function") {
        const current = webview.getURL();
        if (current) return current;
      }
    } catch (_) {}

    return webview.src || webview.getAttribute?.("src") || "";
  }

  isChatGptWebview(webview) {
    return isChatGptUrl(this.getWebviewUrl(webview));
  }

  bindWebview(webview) {
    if (this.boundWebviews.has(webview)) {
      this.attachGuestKeyboard(webview);
      return;
    }

    const domReady = () => {
      this.attachGuestKeyboard(webview);
      this.applyAppearance(webview);

      const activeWebview = this.getWebview(this.app.workspace.activeLeaf);
      if (activeWebview === webview && this.isChatGptWebview(webview)) {
        this.schedulePromptFocus(webview, this.activationSerial);
      }
    };

    const navigated = () => {
      if (this.isChatGptWebview(webview)) {
        this.attachGuestKeyboard(webview);
        this.applyAppearance(webview);
      }
    };

    webview.addEventListener("dom-ready", domReady);
    webview.addEventListener("did-navigate", navigated);
    webview.addEventListener("did-navigate-in-page", navigated);
    this.boundWebviews.set(webview, { domReady, navigated });

    this.attachGuestKeyboard(webview);
  }

  attachGuestKeyboard(webview) {
    if (!this.remote || !this.isChatGptWebview(webview)) return;
    if (typeof webview.getWebContentsId !== "function") return;

    let id;
    let webContents;
    try {
      id = webview.getWebContentsId();
      if (!id || this.guestBindings.has(id)) return;
      webContents = this.remote.webContents.fromId(id);
    } catch (error) {
      this.warnRemote(error);
      return;
    }

    if (!webContents) return;

    const beforeInput = (event, input) => this.handleGuestInput(event, input);

    const destroyed = () => {
      const binding = this.guestBindings.get(id);
      if (!binding) return;
      try {
        binding.webContents.removeListener("before-input-event", binding.beforeInput);
      } catch (_) {}
      this.guestBindings.delete(id);
    };

    webContents.on("before-input-event", beforeInput);
    webContents.once("destroyed", destroyed);
    this.guestBindings.set(id, { webContents, beforeInput, destroyed });
  }

  handleGuestInput(event, input) {
    if (!isPotentialObsidianShortcut(input)) return;

    const commandsApi = this.app.commands;
    const hotkeyManager = this.app.hotkeyManager;
    const commands = commandsApi && commandsApi.commands;
    if (!commandsApi || !hotkeyManager || !commands) return;

    for (const commandId of Object.keys(commands)) {
      const hotkeys = this.getEffectiveHotkeys(hotkeyManager, commandId);
      if (!hotkeys || hotkeys.length === 0) continue;
      if (!hotkeys.some((hotkey) => hotkeyMatchesInput(hotkey, input))) continue;

      let handled = false;
      try {
        handled = Boolean(commandsApi.executeCommandById(commandId));
      } catch (error) {
        console.error(`[GPT Obsidian] Failed to execute command ${commandId}:`, error);
      }

      if (handled) {
        event.preventDefault();
        return;
      }
    }
  }

  getEffectiveHotkeys(manager, commandId) {
    const custom = manager.customKeys;
    if (custom && Object.prototype.hasOwnProperty.call(custom, commandId)) {
      return Array.isArray(custom[commandId]) ? custom[commandId] : [];
    }

    const defaults = manager.defaultKeys;
    if (defaults && Array.isArray(defaults[commandId])) return defaults[commandId];

    if (typeof manager.getHotkeys === "function") {
      try {
        const hotkeys = manager.getHotkeys(commandId);
        if (Array.isArray(hotkeys)) return hotkeys;
      } catch (_) {}
    }

    if (typeof manager.getDefaultHotkeys === "function") {
      try {
        const hotkeys = manager.getDefaultHotkeys(commandId);
        if (Array.isArray(hotkeys)) return hotkeys;
      } catch (_) {}
    }

    return [];
  }

  schedulePromptFocus(webview, serial) {
    for (const delay of PROMPT_FOCUS_DELAYS) {
      window.setTimeout(() => {
        if (serial !== this.activationSerial) return;
        if (this.getWebview(this.app.workspace.activeLeaf) !== webview) return;
        if (!this.isChatGptWebview(webview)) return;
        this.focusPrompt(webview);
      }, delay);
    }
  }

  async focusPrompt(webview) {
    try {
      if (typeof webview.focus === "function") webview.focus();
      if (typeof webview.executeJavaScript !== "function") return;
      await webview.executeJavaScript(FOCUS_PROMPT_SCRIPT, true);
    } catch (_) {
      // Navigation can replace the guest document between activation and execution.
    }
  }

  warnRemote(error) {
    if (this.warnedRemote) return;
    this.warnedRemote = true;
    console.warn(
      "[GPT Obsidian] Electron guest keyboard interception is unavailable; prompt autofocus will still work.",
      error
    );
  }
}

module.exports = GptObsidianPlugin;

module.exports._test = {
  normalizeKey,
  keyCandidates,
  hotkeyMatchesInput,
  isPotentialObsidianShortcut,
  isChatGptUrl,
  parseRgb,
  invertColor,
  mixColor,
  sanitizeCssColor,
  buildAppearanceScript
};
