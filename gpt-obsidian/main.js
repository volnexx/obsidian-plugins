const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const DEFAULT_SETTINGS = {
  syncTheme: true,
  complementaryUserColor: true,
  autoFocusPrompt: true,
};

class GptObsidianSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'GPT Obsidian' });

    new Setting(containerEl)
      .setName('Синхронизировать тему')
      .setDesc('Перекрашивать ChatGPT под текущую тему Obsidian.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.syncTheme)
        .onChange(async (value) => {
          this.plugin.settings.syncTheme = value;
          await this.plugin.saveSettings();
          this.plugin.forceRefresh();
        }));

    new Setting(containerEl)
      .setName('Отрицательный цвет сообщений')
      .setDesc('Использовать комплементарный цвет акцента темы для твоих сообщений и кнопки отправки.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.complementaryUserColor)
        .onChange(async (value) => {
          this.plugin.settings.complementaryUserColor = value;
          await this.plugin.saveSettings();
          this.plugin.forceRefresh();
        }));

    new Setting(containerEl)
      .setName('Фокусировать поле ввода')
      .setDesc('После открытия новой вкладки ChatGPT сразу ставить курсор в поле сообщения.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoFocusPrompt)
        .onChange(async (value) => {
          this.plugin.settings.autoFocusPrompt = value;
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = class GptObsidianPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.webviews = new WeakMap();
    this.lastThemeSignature = '';
    this.refreshQueued = false;

    this.addSettingTab(new GptObsidianSettingTab(this.app, this));

    this.addCommand({
      id: 'refresh-gpt-obsidian-theme',
      name: 'Обновить тему ChatGPT',
      callback: () => this.forceRefresh(),
    });

    this.registerEvent(this.app.workspace.on('layout-change', () => this.queueScan()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.queueScan(true)));

    const observer = new MutationObserver(() => this.queueScan());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    this.register(() => observer.disconnect());

    this.registerInterval(window.setInterval(() => this.scanAndSync(false), 120));
    this.app.workspace.onLayoutReady(() => this.scanAndSync(true));
  }

  onunload() {
    this.webviews = new WeakMap();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  queueScan(focusActive = false) {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    window.setTimeout(() => {
      this.refreshQueued = false;
      this.scanAndSync(focusActive);
    }, 30);
  }

  forceRefresh() {
    this.lastThemeSignature = '';
    for (const webview of this.collectWebviews()) {
      const meta = this.webviews.get(webview);
      if (meta) meta.themeSignature = '';
    }
    this.scanAndSync(false, true);
  }

  collectWebviews() {
    const result = new Set();

    try {
      const leaves = this.app.workspace.getLeavesOfType('webviewer') || [];
      for (const leaf of leaves) {
        const view = leaf?.view;
        const candidates = [
          view?.webviewEl,
          view?.webview,
          view?.containerEl?.querySelector?.('webview'),
          leaf?.containerEl?.querySelector?.('webview'),
        ];
        for (const candidate of candidates) {
          if (candidate && typeof candidate.executeJavaScript === 'function') {
            result.add(candidate);
          }
        }
      }
    } catch (error) {
      console.debug('[GPT Obsidian] Could not enumerate Web Viewer leaves:', error);
    }

    for (const webview of document.querySelectorAll('webview')) {
      if (typeof webview.executeJavaScript === 'function') result.add(webview);
    }

    return [...result];
  }

  getWebviewUrl(webview) {
    try {
      const current = typeof webview.getURL === 'function' ? webview.getURL() : '';
      if (current) return current;
    } catch (_) {}
    return webview.getAttribute?.('src') || webview.src || '';
  }

  isChatGptUrl(url) {
    if (!url) return false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
    } catch (_) {
      return String(url).toLowerCase().includes('chatgpt.com');
    }
  }

  attachWebview(webview) {
    if (this.webviews.has(webview)) return this.webviews.get(webview);

    const meta = {
      themeSignature: '',
      focusDoneForDocument: false,
      handlers: [],
    };

    const onDomReady = () => {
      meta.themeSignature = '';
      meta.focusDoneForDocument = false;
      this.applyToWebview(webview, true, true);
    };
    const onNavigate = () => {
      meta.themeSignature = '';
      meta.focusDoneForDocument = false;
      window.setTimeout(() => this.applyToWebview(webview, true, true), 40);
    };

    for (const [name, fn] of [
      ['dom-ready', onDomReady],
      ['did-navigate', onNavigate],
      ['did-navigate-in-page', onNavigate],
    ]) {
      try {
        webview.addEventListener(name, fn);
        meta.handlers.push([name, fn]);
      } catch (_) {}
    }

    this.webviews.set(webview, meta);
    return meta;
  }

  scanAndSync(focusActive = false, force = false) {
    const theme = this.readTheme();
    const signature = JSON.stringify(theme);
    const globalThemeChanged = signature !== this.lastThemeSignature;
    if (globalThemeChanged) this.lastThemeSignature = signature;

    for (const webview of this.collectWebviews()) {
      const url = this.getWebviewUrl(webview);
      if (!this.isChatGptUrl(url)) continue;

      const meta = this.attachWebview(webview);
      const shouldTheme = force || globalThemeChanged || meta.themeSignature !== signature;
      const shouldFocus = this.settings.autoFocusPrompt && !meta.focusDoneForDocument;

      if (shouldTheme || shouldFocus) {
        this.applyToWebview(webview, shouldFocus, force, theme, signature);
      }
    }
  }

  readTheme() {
    const style = getComputedStyle(document.body || document.documentElement);
    const read = (name, fallback) => {
      const value = style.getPropertyValue(name).trim();
      return this.resolveColor(value || fallback, fallback);
    };

    const accent = read('--interactive-accent', '#7f6df2');
    const accentHover = read('--interactive-accent-hover', accent);
    const negative = this.settings.complementaryUserColor ? this.invertColor(accent) : accent;

    return {
      bgPrimary: read('--background-primary', '#111111'),
      bgSecondary: read('--background-secondary', '#171717'),
      bgSecondaryAlt: read('--background-secondary-alt', '#202020'),
      textNormal: read('--text-normal', '#ececec'),
      textMuted: read('--text-muted', '#a0a0a0'),
      textFaint: read('--text-faint', '#777777'),
      border: read('--background-modifier-border', '#2b2b2b'),
      accent,
      accentHover,
      negative,
      negativeHover: this.mixColor(negative, '#ffffff', 0.12),
      negativeText: this.contrastText(negative),
    };
  }

  resolveColor(value, fallback) {
    if (!value) return fallback;
    const probe = document.createElement('span');
    probe.style.position = 'fixed';
    probe.style.pointerEvents = 'none';
    probe.style.opacity = '0';
    probe.style.color = value;
    (document.body || document.documentElement).appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved || value || fallback;
  }

  parseRgb(color) {
    const match = String(color).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
    const hex = String(color).trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return [127, 109, 242];
  }

  rgbString(rgb) {
    return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
  }

  invertColor(color) {
    const [r, g, b] = this.parseRgb(color);
    return this.rgbString([255 - r, 255 - g, 255 - b]);
  }

  mixColor(a, b, amount) {
    const ca = this.parseRgb(a);
    const cb = this.parseRgb(b);
    return this.rgbString(ca.map((v, i) => v * (1 - amount) + cb[i] * amount));
  }

  contrastText(color) {
    const [r, g, b] = this.parseRgb(color).map((v) => v / 255);
    const linear = (v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    const lum = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    return lum > 0.45 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
  }

  applyToWebview(webview, requestFocus = false, force = false, theme = null, signature = null) {
    const url = this.getWebviewUrl(webview);
    if (!this.isChatGptUrl(url)) return;

    const meta = this.attachWebview(webview);
    const palette = theme || this.readTheme();
    const sig = signature || JSON.stringify(palette);

    if (this.settings.syncTheme && (force || meta.themeSignature !== sig)) {
      const script = this.makeThemeScript(palette);
      try {
        const p = webview.executeJavaScript(script, true);
        if (p && typeof p.catch === 'function') p.catch((error) => console.debug('[GPT Obsidian] Theme injection failed:', error));
        meta.themeSignature = sig;
      } catch (error) {
        console.debug('[GPT Obsidian] Theme injection failed:', error);
      }
    }

    if (requestFocus && this.settings.autoFocusPrompt && !meta.focusDoneForDocument) {
      meta.focusDoneForDocument = true;
      try { webview.focus?.(); } catch (_) {}
      this.focusPrompt(webview);
    }
  }

  makeThemeScript(theme) {
    const vars = {
      '--go-bg-primary': theme.bgPrimary,
      '--go-bg-secondary': theme.bgSecondary,
      '--go-bg-secondary-alt': theme.bgSecondaryAlt,
      '--go-text-normal': theme.textNormal,
      '--go-text-muted': theme.textMuted,
      '--go-text-faint': theme.textFaint,
      '--go-border': theme.border,
      '--go-accent': theme.accent,
      '--go-accent-hover': theme.accentHover,
      '--go-negative': theme.negative,
      '--go-negative-hover': theme.negativeHover,
      '--go-negative-text': theme.negativeText,
    };

    const css = `
      :root {
        --main-surface-background: var(--go-bg-primary) !important;
        --main-surface-primary: var(--go-bg-primary) !important;
        --main-surface-secondary: var(--go-bg-secondary) !important;
        --main-surface-tertiary: var(--go-bg-secondary-alt) !important;
        --sidebar-surface-primary: var(--go-bg-secondary) !important;
        --sidebar-surface-secondary: var(--go-bg-secondary-alt) !important;
        --sidebar-surface-tertiary: var(--go-bg-secondary-alt) !important;
        --message-surface: var(--go-bg-secondary-alt) !important;
        --composer-surface: var(--go-bg-secondary) !important;
        --composer-surface-primary: var(--go-bg-secondary) !important;
        --text-primary: var(--go-text-normal) !important;
        --text-secondary: var(--go-text-muted) !important;
        --text-tertiary: var(--go-text-faint) !important;
        --border-light: var(--go-border) !important;
        --border-medium: var(--go-border) !important;
        --link: var(--go-accent) !important;
        --composer-blue-bg: var(--go-negative) !important;
        --composer-blue-hover: var(--go-negative-hover) !important;
        --composer-blue-text: var(--go-negative-text) !important;
      }

      html, body, main, #__next { background: var(--go-bg-primary) !important; color: var(--go-text-normal) !important; }
      nav, aside { background-color: var(--go-bg-secondary) !important; }

      [data-message-author-role="user"] .user-message-bubble-color,
      [data-message-author-role="user"] [class*="user-message-bubble"],
      [data-message-author-role="user"] [class*="bg-token-message-surface"] {
        background-color: var(--go-negative) !important;
        color: var(--go-negative-text) !important;
      }
      [data-message-author-role="user"] .user-message-bubble-color *,
      [data-message-author-role="user"] [class*="user-message-bubble"] * {
        color: var(--go-negative-text) !important;
      }

      button[data-testid="send-button"],
      [data-testid="send-button"] {
        background-color: var(--go-negative) !important;
        color: var(--go-negative-text) !important;
        border-color: var(--go-negative) !important;
      }
      button[data-testid="send-button"]:hover,
      [data-testid="send-button"]:hover { background-color: var(--go-negative-hover) !important; }
      button[data-testid="send-button"] svg,
      [data-testid="send-button"] svg { color: var(--go-negative-text) !important; stroke: currentColor !important; }

      #prompt-textarea,
      form [contenteditable="true"] {
        caret-color: var(--go-accent) !important;
      }

      ::selection { background: var(--go-accent) !important; color: var(--go-bg-primary) !important; }
      a { color: var(--go-accent) !important; }
    `;

    return `(() => {
      const root = document.documentElement;
      const vars = ${JSON.stringify(vars)};
      for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
      let style = document.getElementById('gpt-obsidian-theme');
      if (!style) {
        style = document.createElement('style');
        style.id = 'gpt-obsidian-theme';
        (document.head || root).appendChild(style);
      }
      style.textContent = ${JSON.stringify(css)};
      root.dataset.gptObsidian = '1';
      return true;
    })()`;
  }

  focusPrompt(webview) {
    const script = `(() => {
      const focus = () => {
        const el = document.querySelector('#prompt-textarea') ||
          document.querySelector('[contenteditable="true"][data-virtualkeyboard]') ||
          document.querySelector('form [contenteditable="true"]') ||
          document.querySelector('textarea');
        if (!el) return false;
        try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
        if (el instanceof HTMLElement) {
          const selection = window.getSelection?.();
          if (selection && el.isContentEditable) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
        return true;
      };
      if (focus()) return true;
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (focus() || attempts >= 20) clearInterval(timer);
      }, 100);
      return false;
    })()`;

    try {
      const p = webview.executeJavaScript(script, true);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
  }
};
