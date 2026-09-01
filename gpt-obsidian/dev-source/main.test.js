const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.attributeOrder = [];
    this.children = [];
    this.parentElement = null;
    this.isConnected = false;
    this.listeners = new Map();
    this.classes = new Set();
    this.style = {};
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name)
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    this.attributeOrder.push(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }

  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name, ...args) {
    for (const listener of [...(this.listeners.get(name) || [])]) listener(...args);
  }

  listenerCount(name) {
    return this.listeners.get(name)?.size || 0;
  }

  appendChild(child) {
    child.parentElement = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  replaceChildren() {
    for (const child of this.children) {
      child.parentElement = null;
      child.isConnected = false;
    }
    this.children = [];
  }

  empty() {
    this.replaceChildren();
  }

  addClass(name) {
    this.classes.add(name);
  }

  removeClass(name) {
    this.classes.delete(name);
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    this.parentElement = null;
    this.isConnected = false;
  }
}

class FakeItemView {
  constructor(leaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.contentEl = leaf.contentEl || new FakeElement("div");
    this.baseStateCalls = [];
  }

  async setState(state, result) {
    this.baseStateCalls.push({ state, result });
  }
}

class FakePlugin {
  constructor(app) {
    this.app = app;
    this.registeredViews = new Map();
    this.commands = [];
  }

  registerView(type, factory) {
    this.registeredViews.set(type, factory);
  }

  addCommand(command) {
    this.commands.push(command);
  }
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    return { ItemView: FakeItemView, Plugin: FakePlugin };
  }
  return originalLoad.call(this, request, parent, isMain);
};

global.document = {
  createElement: (tagName) => new FakeElement(tagName)
};

const manifest = require("./manifest.json");
const GPTObsidianPlugin = require("./main.js");
const { GPTObsidianView } = GPTObsidianPlugin;
const {
  CHATGPT_PARTITION,
  DEFAULT_CHATGPT_URL,
  OWNER_ATTRIBUTE,
  SECURE_WEB_PREFERENCES,
  VIEW_CLASS,
  VIEW_TYPE
} = GPTObsidianPlugin._test;

function makeApp() {
  let app;
  const workspace = {
    createdLeaves: [],
    revealedLeaves: [],
    detachedTypes: [],
    saveLayoutCalls: 0,
    getLeaf(mode) {
      const leaf = {
        app,
        mode,
        viewState: null,
        async setViewState(state) { this.viewState = state; }
      };
      this.createdLeaves.push(leaf);
      return leaf;
    },
    async revealLeaf(leaf) {
      this.revealedLeaves.push(leaf);
    },
    detachLeavesOfType(type) {
      this.detachedTypes.push(type);
    },
    requestSaveLayout() {
      this.saveLayoutCalls += 1;
    }
  };
  app = { workspace };
  return app;
}

async function openView(app, state = null) {
  const contentEl = new FakeElement("div");
  const leaf = { app, contentEl };
  const view = new GPTObsidianView(leaf);
  if (state) await view.setState(state, {});
  await view.onOpen();
  return { contentEl, leaf, view, webview: view.webview };
}

test("manifest defines the new GPT Obsidian 2.0.0 identity", () => {
  assert.equal(manifest.id, "gpt-obsidian");
  assert.equal(manifest.name, "GPT Obsidian");
  assert.equal(manifest.version, "2.0.0");
  assert.equal(manifest.isDesktopOnly, true);
});

test("plugin registers its custom ItemView and open-tab command", () => {
  const app = makeApp();
  const plugin = new GPTObsidianPlugin(app);
  plugin.onload();

  assert.equal(plugin.registeredViews.size, 1);
  assert.equal(typeof plugin.registeredViews.get(VIEW_TYPE), "function");
  assert.deepEqual(plugin.commands.map((command) => [command.id, command.name]), [
    ["open-new-chatgpt-tab", "Open new ChatGPT tab"]
  ]);

  const leaf = { app, contentEl: new FakeElement("div") };
  assert.ok(plugin.registeredViews.get(VIEW_TYPE)(leaf) instanceof GPTObsidianView);
});

test("Open new ChatGPT tab command creates a new tab leaf with GPT view state", async () => {
  const app = makeApp();
  const plugin = new GPTObsidianPlugin(app);
  plugin.onload();

  await plugin.commands[0].callback();

  assert.equal(app.workspace.createdLeaves.length, 1);
  assert.equal(app.workspace.createdLeaves[0].mode, "tab");
  assert.deepEqual(app.workspace.createdLeaves[0].viewState, {
    type: VIEW_TYPE,
    active: true,
    state: { url: DEFAULT_CHATGPT_URL }
  });
  assert.deepEqual(app.workspace.revealedLeaves, [app.workspace.createdLeaves[0]]);
});

test("GPT view creates exactly one explicitly owned persistent ChatGPT webview", async () => {
  const app = makeApp();
  const state = await openView(app);
  await state.view.onOpen();

  assert.equal(state.contentEl.children.length, 1);
  assert.equal(state.view.webview, state.webview);
  assert.equal(state.contentEl.classList.contains(VIEW_CLASS), true);
  assert.equal(state.webview.tagName, "WEBVIEW");
  assert.equal(state.webview.getAttribute(OWNER_ATTRIBUTE), "true");
  assert.equal(state.webview.getAttribute("partition"), CHATGPT_PARTITION);
  assert.equal(state.webview.getAttribute("src"), DEFAULT_CHATGPT_URL);
  assert.ok(state.webview.attributeOrder.indexOf("partition") < state.webview.attributeOrder.indexOf("src"));
  assert.equal(state.webview.listenerCount("did-navigate"), 1);
  assert.equal(state.webview.listenerCount("did-navigate-in-page"), 1);
});

test("remote ChatGPT page receives no Node integration or web-security bypass", async () => {
  const { webview } = await openView(makeApp());

  assert.equal(webview.hasAttribute("nodeintegration"), false);
  assert.equal(webview.hasAttribute("preload"), false);
  assert.equal(webview.hasAttribute("disablewebsecurity"), false);
  assert.equal(webview.hasAttribute("allowpopups"), false);
  assert.equal(webview.getAttribute("webpreferences"), SECURE_WEB_PREFERENCES);
  assert.match(SECURE_WEB_PREFERENCES, /nodeIntegration=no/u);
  assert.match(SECURE_WEB_PREFERENCES, /contextIsolation=yes/u);
  assert.match(SECURE_WEB_PREFERENCES, /sandbox=yes/u);
});

test("two GPT views own different webviews with one shared persistent partition", async () => {
  const app = makeApp();
  const first = await openView(app);
  const second = await openView(app);

  assert.notEqual(first.view, second.view);
  assert.notEqual(first.webview, second.webview);
  assert.equal(first.webview.getAttribute("partition"), CHATGPT_PARTITION);
  assert.equal(second.webview.getAttribute("partition"), CHATGPT_PARTITION);
});

test("closing one GPT view removes only its own webview and listeners", async () => {
  const app = makeApp();
  const first = await openView(app);
  const second = await openView(app);

  await first.view.onClose();

  assert.equal(first.view.webview, null);
  assert.equal(first.contentEl.children.length, 0);
  assert.equal(first.webview.listenerCount("did-navigate"), 0);
  assert.equal(first.webview.listenerCount("did-navigate-in-page"), 0);
  assert.equal(first.webview.isConnected, false);
  assert.equal(second.view.webview, second.webview);
  assert.equal(second.contentEl.children.length, 1);
  assert.equal(second.webview.listenerCount("did-navigate"), 1);
  assert.equal(second.webview.listenerCount("did-navigate-in-page"), 1);
  assert.equal(second.webview.isConnected, true);
});

test("did-navigate updates the leaf-local URL state", async () => {
  const app = makeApp();
  const { view, webview } = await openView(app);
  const url = "https://chatgpt.com/c/document-navigation";

  webview.emit("did-navigate", { url });

  assert.deepEqual(view.getState(), { url });
  assert.equal(app.workspace.saveLayoutCalls, 1);
});

test("did-navigate-in-page updates the leaf-local URL state", async () => {
  const app = makeApp();
  const { view, webview } = await openView(app);
  const url = "https://chatgpt.com/c/spa-navigation";

  webview.emit("did-navigate-in-page", { url, isMainFrame: true });

  assert.deepEqual(view.getState(), { url });
  assert.equal(app.workspace.saveLayoutCalls, 1);
});

test("view URL state round-trips without sharing state across instances", async () => {
  const app = makeApp();
  const first = new GPTObsidianView({ app, contentEl: new FakeElement("div") });
  const second = new GPTObsidianView({ app, contentEl: new FakeElement("div") });
  const url = "https://chatgpt.com/c/round-trip";

  await first.setState({ url }, { history: true });
  await second.setState(first.getState(), { history: false });

  assert.deepEqual(first.getState(), { url });
  assert.deepEqual(second.getState(), { url });
  await second.setState({ url: "https://chatgpt.com/c/second" }, {});
  assert.deepEqual(first.getState(), { url });
});

test("restored conversation URL is applied when the webview is first created", async () => {
  const url = "https://chatgpt.com/c/example";
  const { view, webview } = await openView(makeApp(), { url });

  assert.deepEqual(view.getState(), { url });
  assert.equal(webview.getAttribute("src"), url);
  assert.ok(webview.attributeOrder.indexOf("partition") < webview.attributeOrder.indexOf("src"));
});

test("new plugin source has no global WebViewer discovery, keyboard forwarding, or global patches", () => {
  const source = fs.readFileSync(require.resolve("./main.js"), "utf8");

  assert.doesNotMatch(source, /querySelectorAll\s*\(\s*["']webview/iu);
  assert.doesNotMatch(source, /collectChatGptWebviews/iu);
  assert.doesNotMatch(source, /iterateAllLeaves/iu);
  assert.doesNotMatch(source, /before-input-event/iu);
  assert.doesNotMatch(source, /app\.keymap/iu);
  assert.doesNotMatch(source, /executeCommandById/iu);
  assert.doesNotMatch(source, /permissionPrompter|registerExternalPermissionResolver/iu);
  assert.doesNotMatch(source, /nodeIntegration\s*=\s*true|webSecurity\s*=\s*false|disable-web-security/iu);
});

test("plugin unload detaches only its own view type", () => {
  const app = makeApp();
  const plugin = new GPTObsidianPlugin(app);
  plugin.onload();

  plugin.onunload();

  assert.deepEqual(app.workspace.detachedTypes, [VIEW_TYPE]);
});
