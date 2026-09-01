const { ItemView, Plugin } = require("obsidian");

const VIEW_TYPE = "gpt-obsidian-view";
const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_PARTITION = "persist:gpt-obsidian";
const OWNER_ATTRIBUTE = "data-gpt-obsidian-owned";
const VIEW_CLASS = "gpt-obsidian-native-view";
const SECURE_WEB_PREFERENCES = "contextIsolation=yes,nodeIntegration=no,sandbox=yes";
const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

function normalizeChatGptUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !CHATGPT_HOSTS.has(url.hostname)) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

function emptyElement(element) {
  if (typeof element?.empty === "function") {
    element.empty();
    return;
  }
  element?.replaceChildren?.();
}

function addClass(element, className) {
  if (typeof element?.addClass === "function") {
    element.addClass(className);
    return;
  }
  element?.classList?.add(className);
}

function removeClass(element, className) {
  if (typeof element?.removeClass === "function") {
    element.removeClass(className);
    return;
  }
  element?.classList?.remove(className);
}

class GPTObsidianView extends ItemView {
  constructor(leaf) {
    super(leaf);
    this.currentUrl = DEFAULT_CHATGPT_URL;
    this.webview = null;
    this.navigationListeners = null;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "GPT Obsidian";
  }

  getIcon() {
    return "message-square";
  }

  getState() {
    return { url: this.currentUrl };
  }

  async setState(state, result) {
    if (typeof ItemView.prototype.setState === "function") {
      await ItemView.prototype.setState.call(this, state, result);
    }

    const nextUrl = normalizeChatGptUrl(state?.url) || DEFAULT_CHATGPT_URL;
    this.currentUrl = nextUrl;

    if (this.webview && this.webview.getAttribute?.("src") !== nextUrl) {
      this.webview.setAttribute("src", nextUrl);
    }
  }

  async onOpen() {
    if (this.webview) return;

    const host = this.contentEl;
    if (!host) throw new Error("GPT Obsidian view has no content element");

    emptyElement(host);
    addClass(host, VIEW_CLASS);

    const webview = document.createElement("webview");
    webview.setAttribute(OWNER_ATTRIBUTE, "true");
    webview.setAttribute("partition", CHATGPT_PARTITION);
    webview.setAttribute("webpreferences", SECURE_WEB_PREFERENCES);

    const didNavigate = (event, url) => this.updateCurrentUrl(event?.url || url);
    const didNavigateInPage = (event, url) => this.updateCurrentUrl(event?.url || url);
    webview.addEventListener("did-navigate", didNavigate);
    webview.addEventListener("did-navigate-in-page", didNavigateInPage);

    this.navigationListeners = { didNavigate, didNavigateInPage };
    this.webview = webview;

    webview.setAttribute("src", this.currentUrl);
    host.appendChild(webview);
  }

  async onClose() {
    const webview = this.webview;
    const listeners = this.navigationListeners;
    this.webview = null;
    this.navigationListeners = null;

    if (webview && listeners) {
      try {
        webview.removeEventListener("did-navigate", listeners.didNavigate);
        webview.removeEventListener("did-navigate-in-page", listeners.didNavigateInPage);
      } catch (_) {}
    }

    try { webview?.remove?.(); } catch (_) {}
    removeClass(this.contentEl, VIEW_CLASS);
  }

  updateCurrentUrl(value) {
    const nextUrl = normalizeChatGptUrl(value);
    if (!nextUrl || nextUrl === this.currentUrl) return;
    this.currentUrl = nextUrl;
    this.app?.workspace?.requestSaveLayout?.();
  }
}

class GPTObsidianPlugin extends Plugin {
  onload() {
    this.registerView(VIEW_TYPE, (leaf) => new GPTObsidianView(leaf));
    this.addCommand({
      id: "open-new-chatgpt-tab",
      name: "Open new ChatGPT tab",
      callback: () => this.openNewChatGptTab()
    });
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async openNewChatGptTab() {
    const leaf = this.app.workspace.getLeaf("tab");
    if (!leaf) return null;

    await leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: { url: DEFAULT_CHATGPT_URL }
    });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }
}

module.exports = GPTObsidianPlugin;
module.exports.GPTObsidianView = GPTObsidianView;
module.exports._test = {
  CHATGPT_PARTITION,
  DEFAULT_CHATGPT_URL,
  OWNER_ATTRIBUTE,
  SECURE_WEB_PREFERENCES,
  VIEW_CLASS,
  VIEW_TYPE,
  normalizeChatGptUrl
};
