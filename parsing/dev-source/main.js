var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => RazborPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE = "razbor-view";
var SHORTCUTS = ["A", "S", "D", "J", "K", ";"];
var SHORTCUT_CODES = ["KeyA", "KeyS", "KeyD", "KeyJ", "KeyK", "Semicolon"];
var DEFAULT_SETTINGS = {
  pinnedNotes: ["", "", "", "", "", ""],
  activityPluginId: "activity"
};
var RazborPlugin = class extends import_obsidian.Plugin {
  settings = DEFAULT_SETTINGS;
  actionButtons = /* @__PURE__ */ new Map();
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new RazborView(leaf, this));
    this.addSettingTab(new RazborSettingTab(this.app, this));
    this.addCommand({
      id: "open-for-current-note",
      name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C Parsing \u0434\u043B\u044F \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (!view?.file) return false;
        if (!checking) void this.openForFile(view.file);
        return true;
      }
    });
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      this.attachHeaderAction();
      if (leaf?.view instanceof RazborView) leaf.view.activateKeyboard();
    }));
    this.app.workspace.onLayoutReady(() => this.attachHeaderAction());
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.actionButtons.forEach((button) => button.remove());
    this.actionButtons.clear();
  }
  attachHeaderAction() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!view || this.actionButtons.has(view)) return;
    const button = view.addAction("list-filter", "Parsing: \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0438 \u044D\u0442\u043E\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438", () => {
      if (view.file) void this.openForFile(view.file);
    });
    button.addClass("razbor-header-action");
    this.actionButtons.set(view, button);
  }
  async openForFile(file) {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: { sourcePath: file.path }
    });
    await this.app.workspace.revealLeaf(leaf);
  }
  async getSideNotes(sourcePath) {
    const selected = [];
    const used = /* @__PURE__ */ new Set([sourcePath]);
    for (const configured of this.settings.pinnedNotes) {
      const file = this.resolveNote(configured);
      if (file && !used.has(file.path)) {
        selected.push(file);
        used.add(file.path);
      }
      if (selected.length === 6) return selected;
    }
    for (const entry of await this.readActivityEntries()) {
      const file = this.app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(entry.path));
      if (file instanceof import_obsidian.TFile && file.extension === "md" && !used.has(file.path)) {
        selected.push(file);
        used.add(file.path);
      }
      if (selected.length === 6) return selected;
    }
    return selected;
  }
  resolveNote(value) {
    const query = value.trim();
    if (!query) return null;
    const exactPath = (0, import_obsidian.normalizePath)(query.endsWith(".md") ? query : `${query}.md`);
    const exact = this.app.vault.getAbstractFileByPath(exactPath);
    if (exact instanceof import_obsidian.TFile) return exact;
    const lower = query.replace(/\.md$/i, "").toLocaleLowerCase();
    return this.app.vault.getMarkdownFiles().find(
      (file) => file.basename.toLocaleLowerCase() === lower || file.path.replace(/\.md$/i, "").toLocaleLowerCase() === lower
    ) ?? null;
  }
  async readActivityEntries() {
    const plugins = this.app.plugins?.plugins;
    const activity = plugins?.[this.settings.activityPluginId];
    if (!activity) return [];
    const api = activity.api ?? activity;
    let raw;
    try {
      raw = api.getTopNotes ? await api.getTopNotes(40) : api.getMostOpenedNotes ? await api.getMostOpenedNotes(40) : api.getNoteStats ? await api.getNoteStats() : api.stats;
    } catch (error) {
      console.error("Parsing: \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443 Activity", error);
      return [];
    }
    return normalizeActivityEntries(raw);
  }
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
    this.settings.pinnedNotes = [...this.settings.pinnedNotes ?? []].slice(0, 6);
    while (this.settings.pinnedNotes.length < 6) this.settings.pinnedNotes.push("");
  }
  async saveSettings() {
    await this.saveData(this.settings);
    await this.refreshViews();
  }
  async refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof RazborView) await leaf.view.refreshSideNotes();
    }
  }
};
var RazborView = class _RazborView extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  sourcePath = "";
  lines = [];
  index = 0;
  sideNotes = [];
  inputEl = null;
  suggestionEl = null;
  lineEl = null;
  createNoteRowEl = null;
  createNoteInputEl = null;
  progressEl = null;
  previousButton = null;
  nextButton = null;
  sideButtons = [];
  visibleResults = [];
  searchRequest = 0;
  keyHandler = (event) => this.onKeyDown(event);
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Parsing";
  }
  getIcon() {
    return "list-filter";
  }
  async setState(state, result) {
    this.sourcePath = state.sourcePath ?? "";
    await super.setState(state, result);
    if (this.containerEl.isConnected) await this.loadSource();
  }
  getState() {
    return { sourcePath: this.sourcePath };
  }
  async onOpen() {
    document.addEventListener("keydown", this.keyHandler, true);
    await this.loadSource();
  }
  async onClose() {
    document.removeEventListener("keydown", this.keyHandler, true);
  }
  activateKeyboard() {
    window.setTimeout(() => {
      if (this.isActiveView()) this.inputEl?.focus();
    }, 0);
  }
  async loadSource() {
    const source = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!(source instanceof import_obsidian.TFile)) {
      this.renderError("\u0418\u0441\u0445\u043E\u0434\u043D\u0430\u044F \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430");
      return;
    }
    const content = await this.app.vault.cachedRead(source);
    this.lines = content.split(/\r?\n/).map((original, lineNumber) => {
      const text = original.trim();
      const direct = this.parseDirectTarget(text);
      return { text, original, lineNumber, ...direct };
    }).filter((line) => line.text.length > 0);
    this.index = 0;
    this.sideNotes = await this.plugin.getSideNotes(this.sourcePath);
    this.render();
  }
  async refreshSideNotes() {
    this.sideNotes = await this.plugin.getSideNotes(this.sourcePath);
    if (this.containerEl.isConnected) this.render();
  }
  parseDirectTarget(text) {
    const separators = ["\u2013", "\u2014"];
    const positions = separators.map((separator2) => ({ separator: separator2, position: text.indexOf(separator2) })).filter(({ position: position2 }) => position2 > 0).sort((a, b) => a.position - b.position);
    if (positions.length === 0) return {};
    const { separator, position } = positions[0];
    const title = text.slice(0, position).trim();
    const file = this.plugin.resolveNote(title);
    if (file) return { directTarget: file.path, directText: text.slice(position + separator.length).trim() };
    return {};
  }
  render() {
    const content = this.contentEl;
    content.empty();
    content.addClass("razbor-view");
    this.sideButtons = [];
    const shell = content.createDiv({ cls: "razbor-shell" });
    const header = shell.createDiv({ cls: "razbor-top" });
    header.createDiv({ cls: "razbor-title", text: "PARSING" });
    this.progressEl = header.createDiv({ cls: "razbor-progress" });
    const lineStage = shell.createDiv({ cls: "razbor-line-stage" });
    this.previousButton = this.createNavigationButton(
      lineStage,
      "left",
      "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430",
      "Ctrl+Shift+H",
      () => this.navigate(-1)
    );
    const lineColumn = lineStage.createDiv({ cls: "razbor-line-column" });
    this.createNoteRowEl = lineColumn.createDiv({ cls: "razbor-create-note-row" });
    this.lineEl = lineColumn.createDiv({ cls: "razbor-line-card" });
    this.nextButton = this.createNavigationButton(
      lineStage,
      "right",
      "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430",
      "Ctrl+Shift+L",
      () => this.navigate(1)
    );
    const controls = shell.createDiv({ cls: "razbor-controls" });
    const left = controls.createDiv({ cls: "razbor-side razbor-side-left" });
    const center = controls.createDiv({ cls: "razbor-center" });
    const right = controls.createDiv({ cls: "razbor-side razbor-side-right" });
    this.renderSide(left, this.sideNotes.slice(0, 3), 0);
    this.renderSide(right, this.sideNotes.slice(3, 6), 3);
    this.inputEl = center.createEl("input", {
      cls: "razbor-search",
      attr: { type: "text", placeholder: "\u041A\u0443\u0434\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443\u2026", autocomplete: "off", spellcheck: "false" }
    });
    this.suggestionEl = center.createDiv({ cls: "razbor-suggestions" });
    this.inputEl.addEventListener("input", () => void this.renderSuggestions());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.sendByEnter();
      }
    });
    this.updateCurrentLine();
    window.setTimeout(() => this.inputEl?.focus(), 0);
  }
  createNavigationButton(container, direction, label, shortcut, callback) {
    const button = container.createEl("button", {
      cls: `razbor-nav-button razbor-nav-${direction}`,
      attr: { "aria-label": `${label} (${shortcut})`, title: `${label} \u2014 ${shortcut}` }
    });
    (0, import_obsidian.setIcon)(button, direction === "left" ? "chevron-left" : "chevron-right");
    button.createSpan({ cls: "razbor-nav-key", text: shortcut });
    button.addEventListener("click", callback);
    return button;
  }
  renderSide(container, files, offset) {
    for (let localIndex = 0; localIndex < 3; localIndex++) {
      const file = files[localIndex];
      const shortcutIndex = offset + localIndex;
      const button = container.createEl("button", { cls: "razbor-note-button" });
      button.dataset.index = String(shortcutIndex);
      const key = button.createSpan({ cls: "razbor-key", text: `Ctrl+Shift+${SHORTCUTS[shortcutIndex]}` });
      key.setAttr("aria-hidden", "true");
      const icon = button.createSpan({ cls: "razbor-note-icon" });
      (0, import_obsidian.setIcon)(icon, "file-text");
      button.createSpan({ cls: "razbor-note-name", text: file?.basename ?? "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u043E" });
      button.disabled = !file;
      if (file) button.addEventListener("click", () => void this.assign(file));
      this.sideButtons[shortcutIndex] = button;
    }
  }
  updateCurrentLine() {
    if (!this.lineEl || !this.progressEl) return;
    const current = this.lines[this.index];
    this.lineEl.empty();
    this.closeCreateNoteInput(false);
    this.progressEl.setText(`${Math.min(this.index + 1, this.lines.length)} / ${this.lines.length}`);
    if (!current) {
      this.lineEl.addClass("is-finished");
      this.lineEl.createDiv({ cls: "razbor-finished", text: "\u0412\u0441\u0435 \u0441\u0442\u0440\u043E\u043A\u0438 \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u044B" });
      if (this.inputEl) this.inputEl.disabled = true;
      this.updateNavigationButtons();
      return;
    }
    this.lineEl.removeClass("is-finished");
    const createButton = this.lineEl.createEl("button", {
      cls: "razbor-create-button",
      attr: {
        "aria-label": "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 (Ctrl+Shift+Enter)",
        title: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u2014 Ctrl+Shift+Enter"
      }
    });
    (0, import_obsidian.setIcon)(createButton, "file-plus-2");
    createButton.createSpan({ cls: "razbor-create-key", text: "Ctrl+Shift+Enter" });
    createButton.addEventListener("click", () => this.openCreateNoteInput());
    const deleteButton = this.lineEl.createEl("button", {
      cls: "razbor-delete-button",
      attr: {
        "aria-label": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443 (Ctrl+Shift+Backspace)",
        title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443 \u2014 Ctrl+Shift+Backspace"
      }
    });
    (0, import_obsidian.setIcon)(deleteButton, "trash-2");
    deleteButton.createSpan({ cls: "razbor-delete-key", text: "Ctrl+Shift+Backspace" });
    deleteButton.addEventListener("click", () => void this.deleteCurrentLine());
    this.lineEl.createDiv({ cls: "razbor-line-text", text: current.text });
    if (current.directTarget) {
      const target = this.app.vault.getAbstractFileByPath(current.directTarget);
      this.lineEl.createDiv({
        cls: "razbor-direct-hint",
        text: `Enter \u2192 ${target instanceof import_obsidian.TFile ? target.basename : current.directTarget}`
      });
      if (this.inputEl) this.inputEl.placeholder = "Enter \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442 \u043F\u043E \u0443\u043A\u0430\u0437\u0430\u043D\u043D\u043E\u043C\u0443 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E";
    } else if (this.inputEl) {
      this.inputEl.placeholder = "\u041A\u0443\u0434\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443\u2026";
    }
    if (this.inputEl) this.inputEl.value = "";
    if (this.inputEl) this.inputEl.disabled = false;
    this.updateNavigationButtons();
    void this.renderSuggestions();
  }
  openCreateNoteInput() {
    if (!this.lines[this.index] || !this.createNoteRowEl) return;
    if (this.createNoteInputEl) {
      this.createNoteInputEl.focus();
      return;
    }
    this.createNoteRowEl.empty();
    this.createNoteRowEl.addClass("is-open");
    this.createNoteInputEl = this.createNoteRowEl.createEl("input", {
      cls: "razbor-create-note-input",
      attr: {
        type: "text",
        placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043D\u043E\u0432\u043E\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438\u2026",
        autocomplete: "off",
        spellcheck: "false"
      }
    });
    this.createNoteInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        void this.createNoteAndAssign();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeCreateNoteInput();
      }
    });
    this.createNoteInputEl.focus();
  }
  closeCreateNoteInput(focusSearch = true) {
    this.createNoteInputEl = null;
    this.createNoteRowEl?.empty();
    this.createNoteRowEl?.removeClass("is-open");
    if (focusSearch) this.inputEl?.focus();
  }
  async createNoteAndAssign() {
    const current = this.lines[this.index];
    const rawName = this.createNoteInputEl?.value.trim() ?? "";
    if (!current || !rawName) {
      new import_obsidian.Notice("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043D\u043E\u0432\u043E\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438");
      return;
    }
    const withoutExtension = rawName.replace(/\.md$/i, "").trim();
    if (!withoutExtension || /[\\:*?"<>|]/.test(withoutExtension)) {
      new import_obsidian.Notice("\u0412 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0438 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0435\u0441\u0442\u044C \u043D\u0435\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0435 \u0441\u0438\u043C\u0432\u043E\u043B\u044B");
      return;
    }
    const path = (0, import_obsidian.normalizePath)(`${withoutExtension}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) {
      new import_obsidian.Notice("\u0417\u0430\u043C\u0435\u0442\u043A\u0430 \u0441 \u0442\u0430\u043A\u0438\u043C \u0438\u043C\u0435\u043D\u0435\u043C \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442");
      this.createNoteInputEl?.focus();
      return;
    }
    try {
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parentPath) await this.ensureFolder(parentPath);
      await this.app.vault.create(path, `${current.text}
`);
      await this.removeFromSource(current.original);
      this.closeCreateNoteInput(false);
      this.removeCurrentFromQueue();
      this.updateCurrentLine();
      this.inputEl?.focus();
    } catch (error) {
      console.error("Parsing: \u043E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0437\u0430\u043C\u0435\u0442\u043A\u0438", error);
      new import_obsidian.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443");
      this.createNoteInputEl?.focus();
    }
  }
  async ensureFolder(folderPath) {
    const parts = (0, import_obsidian.normalizePath)(folderPath).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }
  navigate(offset) {
    const nextIndex = this.index + offset;
    if (nextIndex < 0 || nextIndex >= this.lines.length) return;
    this.index = nextIndex;
    this.updateCurrentLine();
    this.inputEl?.focus();
  }
  updateNavigationButtons() {
    if (this.previousButton) this.previousButton.disabled = this.index <= 0 || this.lines.length === 0;
    if (this.nextButton) this.nextButton.disabled = this.index >= this.lines.length - 1 || this.lines.length === 0;
  }
  async renderSuggestions() {
    if (!this.suggestionEl) return;
    const request = ++this.searchRequest;
    this.suggestionEl.empty();
    this.visibleResults = [];
    const current = this.lines[this.index];
    if (!current) return;
    if (current.directTarget && !this.inputEl?.value.trim()) {
      const file = this.app.vault.getAbstractFileByPath(current.directTarget);
      if (file instanceof import_obsidian.TFile) {
        this.visibleResults = [file];
        this.createSuggestion(file, true);
      }
      return;
    }
    const query = this.inputEl?.value ?? "";
    const results = await this.getSearchResults(query);
    if (request !== this.searchRequest || !this.suggestionEl) return;
    this.suggestionEl.empty();
    this.visibleResults = results.map((result) => result.file);
    for (const result of results) {
      this.createSuggestion(result.file, false, result.excerpt);
    }
  }
  createSuggestion(file, direct, excerpt) {
    if (!this.suggestionEl) return;
    const button = this.suggestionEl.createEl("button", { cls: "razbor-suggestion" });
    const icon = button.createSpan({ cls: "razbor-suggestion-icon" });
    (0, import_obsidian.setIcon)(icon, direct ? "corner-down-right" : "file-text");
    const labels = button.createSpan({ cls: "razbor-suggestion-labels" });
    labels.createSpan({ cls: "razbor-suggestion-title", text: file.basename });
    labels.createSpan({ cls: "razbor-suggestion-path", text: file.parent?.path === "/" ? "" : file.parent?.path ?? "" });
    if (excerpt) labels.createSpan({ cls: "razbor-suggestion-excerpt", text: cleanExcerpt(excerpt) });
    button.addEventListener("click", () => void this.assign(file));
  }
  async getSearchResults(query) {
    const files = this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourcePath);
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return files.slice().sort((a, b) => a.basename.localeCompare(b.basename, "ru")).slice(0, 7).map((file) => ({ file }));
    const omnisearch = this.getOmnisearch();
    if (omnisearch) {
      try {
        const results = await omnisearch.search(query.trim());
        const mapped = results.map((result) => {
          const file = this.app.vault.getAbstractFileByPath(result.path);
          return file instanceof import_obsidian.TFile && file.extension === "md" && file.path !== this.sourcePath ? { file, excerpt: result.excerpt } : null;
        }).filter((result) => result !== null);
        if (mapped.length) return mapped.slice(0, 7);
      } catch (error) {
        console.error("Parsing: \u043E\u0448\u0438\u0431\u043A\u0430 Omnisearch, \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0437\u0430\u043F\u0430\u0441\u043D\u043E\u0439 \u043F\u043E\u0438\u0441\u043A", error);
      }
    }
    return files.map((file) => ({ file, score: noteScore(file, normalized) })).sort((a, b) => b.score - a.score || a.file.basename.localeCompare(b.file.basename, "ru")).slice(0, 7).map((entry) => ({ file: entry.file }));
  }
  getOmnisearch() {
    const globalApi = globalThis.omnisearch;
    if (globalApi?.search) return globalApi;
    const plugins = this.app.plugins?.plugins;
    const plugin = plugins?.omnisearch;
    if (plugin?.api?.search) return plugin.api;
    if (plugin?.search) return { search: plugin.search.bind(plugin) };
    return null;
  }
  async sendByEnter() {
    const current = this.lines[this.index];
    if (!current) return;
    if (current.directTarget && !this.inputEl?.value.trim()) {
      const file = this.app.vault.getAbstractFileByPath(current.directTarget);
      if (file instanceof import_obsidian.TFile) await this.assign(file, current.directText ?? "");
      return;
    }
    let match = this.visibleResults[0];
    if (!match) match = (await this.getSearchResults(this.inputEl?.value ?? ""))[0]?.file;
    if (match) await this.assign(match);
  }
  async assign(target, overrideText) {
    const current = this.lines[this.index];
    if (!current) return;
    const text = overrideText ?? current.text;
    if (!text) {
      new import_obsidian.Notice("\u041F\u043E\u0441\u043B\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0441\u0442\u0440\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u0430");
      return;
    }
    try {
      const targetContent = await this.app.vault.cachedRead(target);
      const formattedText = formatForPerspectivism(text, targetContent);
      await this.app.vault.process(target, (content) => appendLine(content, formattedText));
      await this.removeFromSource(current.original);
      this.removeCurrentFromQueue();
      this.updateCurrentLine();
      this.inputEl?.focus();
    } catch (error) {
      console.error("Parsing: \u043E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u043F\u0438\u0441\u0438", error);
      new import_obsidian.Notice(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443 \u0432 \xAB${target.basename}\xBB`);
    }
  }
  async removeFromSource(original) {
    const source = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!(source instanceof import_obsidian.TFile)) return;
    await this.app.vault.process(source, (content) => {
      const eol = content.includes("\r\n") ? "\r\n" : "\n";
      const lines = content.split(/\r?\n/);
      const index = lines.indexOf(original);
      if (index >= 0) lines.splice(index, 1);
      return lines.join(eol);
    });
  }
  removeCurrentFromQueue() {
    this.lines.splice(this.index, 1);
    if (this.index >= this.lines.length && this.lines.length > 0) this.index = this.lines.length - 1;
  }
  async deleteCurrentLine() {
    const current = this.lines[this.index];
    if (!current) return;
    try {
      await this.removeFromSource(current.original);
      this.lines.splice(this.index, 1);
      if (this.index >= this.lines.length && this.lines.length > 0) this.index = this.lines.length - 1;
      this.updateCurrentLine();
      this.inputEl?.focus();
    } catch (error) {
      console.error("Parsing: \u043E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0441\u0442\u0440\u043E\u043A\u0438", error);
      new import_obsidian.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443 \u0438\u0437 \u0438\u0441\u0445\u043E\u0434\u043D\u043E\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438");
    }
  }
  onKeyDown(event) {
    if (!this.isActiveView()) return;
    if (event.target === this.createNoteInputEl) return;
    const target = event.target;
    const isTextTarget = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable;
    if (!isTextTarget && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
      event.preventDefault();
      this.inputEl?.focus();
      if (this.inputEl) {
        this.inputEl.value += event.key;
        this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      event.stopPropagation();
      this.navigate(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && (event.code === "KeyH" || event.code === "KeyL")) {
      event.preventDefault();
      event.stopPropagation();
      this.navigate(event.code === "KeyH" ? -1 : 1);
      return;
    }
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      void this.deleteCurrentLine();
      return;
    }
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.openCreateNoteInput();
      return;
    }
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
    const index = SHORTCUT_CODES.indexOf(event.code);
    if (index < 0) return;
    const file = this.sideNotes[index];
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void this.assign(file);
  }
  isActiveView() {
    return this.app.workspace.getActiveViewOfType(_RazborView) === this;
  }
  renderError(message) {
    this.contentEl.empty();
    this.contentEl.createDiv({ cls: "razbor-error", text: message });
  }
};
var RazborSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Parsing" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u044B\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0437\u0430\u043D\u0438\u043C\u0430\u044E\u0442 \u0431\u043E\u043A\u043E\u0432\u044B\u0435 \u043A\u043D\u043E\u043F\u043A\u0438 \u0440\u0430\u043D\u044C\u0448\u0435 \u0437\u0430\u043C\u0435\u0442\u043E\u043A \u0438\u0437 Activity. \u041C\u043E\u0436\u043D\u043E \u0443\u043A\u0430\u0437\u0430\u0442\u044C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0438\u043B\u0438 \u043F\u043E\u043B\u043D\u044B\u0439 \u043F\u0443\u0442\u044C."
    });
    for (let index = 0; index < 6; index++) {
      new import_obsidian.Setting(containerEl).setName(`\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u0430\u044F \u0437\u0430\u043C\u0435\u0442\u043A\u0430 ${index + 1}`).setDesc(`Ctrl+Shift+${SHORTCUTS[index]}`).addText((text) => text.setPlaceholder("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0438\u043B\u0438 \u043F\u0443\u0442\u044C").setValue(this.plugin.settings.pinnedNotes[index] ?? "").onChange(async (value) => {
        this.plugin.settings.pinnedNotes[index] = value.trim();
        await this.plugin.saveSettings();
      }));
    }
    new import_obsidian.Setting(containerEl).setName("\u0418\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440 \u043F\u043B\u0430\u0433\u0438\u043D\u0430 Activity").setDesc("\u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E: activity").addText((text) => text.setValue(this.plugin.settings.activityPluginId).onChange(async (value) => {
      this.plugin.settings.activityPluginId = value.trim() || "activity";
      await this.plugin.saveSettings();
    }));
  }
};
function appendLine(content, text) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  if (!content.length) return text;
  const lines = content.split(/\r?\n/);
  const serviceIndex = lines.findIndex((line) => line.trim().toLocaleLowerCase() === "ppp");
  if (serviceIndex >= 0) {
    lines.splice(serviceIndex, 0, text);
    return lines.join(eol);
  }
  return `${content.replace(/(?:\r?\n)*$/, "")}${eol}${text}${eol}`;
}
function formatForPerspectivism(text, targetContent) {
  const template = findPerspectivismTemplate(targetContent);
  return template?.includes("p") ? template.split("p").join(text) : text;
}
function findPerspectivismTemplate(content) {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().toLocaleLowerCase() === "ppp") return lines[index + 1] ?? "";
  }
  return null;
}
function cleanExcerpt(excerpt) {
  return excerpt.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
function noteScore(file, query) {
  const title = file.basename.toLocaleLowerCase();
  const path = file.path.toLocaleLowerCase();
  if (title === query) return 1e5;
  let score = 0;
  if (title.startsWith(query)) score += 3e3;
  if (title.includes(query)) score += 1800 - title.indexOf(query) * 5;
  if (path.includes(query)) score += 400;
  score += subsequenceScore(title, query);
  score -= levenshtein(title, query) * 8;
  return score;
}
function subsequenceScore(text, query) {
  let queryIndex = 0;
  let streak = 0;
  let score = 0;
  for (const character of text) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
      streak += 1;
      score += 20 + streak * 8;
      if (queryIndex === query.length) return score;
    } else streak = 0;
  }
  return queryIndex === query.length ? score : -1e3;
}
function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const saved = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[right.length];
}
function normalizeActivityEntries(raw) {
  const source = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.entries(raw).map(([path, value]) => value && typeof value === "object" ? { path, ...value } : { path, openCount: value }) : [];
  return source.map((item) => {
    if (typeof item === "string") return { path: item, openCount: 0 };
    if (!item || typeof item !== "object") return null;
    const row = item;
    const path = row.path ?? row.filePath ?? row.notePath;
    const count = row.openCount ?? row.opens ?? row.openings ?? row.count ?? 0;
    return typeof path === "string" ? { path, openCount: Number(count) || 0 } : null;
  }).filter((entry) => entry !== null).sort((a, b) => b.openCount - a.openCount);
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgSXRlbVZpZXcsXG4gIE1hcmtkb3duVmlldyxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFBsdWdpblNldHRpbmdUYWIsXG4gIFNldHRpbmcsXG4gIFRGaWxlLFxuICBWaWV3U3RhdGVSZXN1bHQsXG4gIFdvcmtzcGFjZUxlYWYsXG4gIG5vcm1hbGl6ZVBhdGgsXG4gIHNldEljb25cbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmNvbnN0IFZJRVdfVFlQRSA9IFwicmF6Ym9yLXZpZXdcIjtcbmNvbnN0IFNIT1JUQ1VUUyA9IFtcIkFcIiwgXCJTXCIsIFwiRFwiLCBcIkpcIiwgXCJLXCIsIFwiO1wiXSBhcyBjb25zdDtcbmNvbnN0IFNIT1JUQ1VUX0NPREVTID0gW1wiS2V5QVwiLCBcIktleVNcIiwgXCJLZXlEXCIsIFwiS2V5SlwiLCBcIktleUtcIiwgXCJTZW1pY29sb25cIl0gYXMgY29uc3Q7XG5cbmludGVyZmFjZSBSYXpib3JTZXR0aW5ncyB7XG4gIHBpbm5lZE5vdGVzOiBzdHJpbmdbXTtcbiAgYWN0aXZpdHlQbHVnaW5JZDogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgUmV2aWV3TGluZSB7XG4gIHRleHQ6IHN0cmluZztcbiAgb3JpZ2luYWw6IHN0cmluZztcbiAgbGluZU51bWJlcjogbnVtYmVyO1xuICBkaXJlY3RUYXJnZXQ/OiBzdHJpbmc7XG4gIGRpcmVjdFRleHQ/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBBY3Rpdml0eUVudHJ5IHtcbiAgcGF0aDogc3RyaW5nO1xuICBvcGVuQ291bnQ6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIEFjdGl2aXR5QXBpIHtcbiAgZ2V0VG9wTm90ZXM/OiAobGltaXQ6IG51bWJlcikgPT4gUHJvbWlzZTx1bmtub3duPiB8IHVua25vd247XG4gIGdldE1vc3RPcGVuZWROb3Rlcz86IChsaW1pdDogbnVtYmVyKSA9PiBQcm9taXNlPHVua25vd24+IHwgdW5rbm93bjtcbiAgZ2V0Tm90ZVN0YXRzPzogKCkgPT4gUHJvbWlzZTx1bmtub3duPiB8IHVua25vd247XG4gIGFwaT86IEFjdGl2aXR5QXBpO1xuICBzdGF0cz86IHVua25vd247XG59XG5cbmludGVyZmFjZSBPbW5pc2VhcmNoUmVzdWx0IHtcbiAgc2NvcmU6IG51bWJlcjtcbiAgcGF0aDogc3RyaW5nO1xuICBleGNlcnB0Pzogc3RyaW5nO1xuICBiYXNlbmFtZT86IHN0cmluZztcbiAgZm91bmRXb3Jkcz86IHN0cmluZ1tdO1xufVxuXG5pbnRlcmZhY2UgT21uaXNlYXJjaEFwaSB7XG4gIHNlYXJjaDogKHF1ZXJ5OiBzdHJpbmcpID0+IFByb21pc2U8T21uaXNlYXJjaFJlc3VsdFtdPjtcbn1cblxuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogUmF6Ym9yU2V0dGluZ3MgPSB7XG4gIHBpbm5lZE5vdGVzOiBbXCJcIiwgXCJcIiwgXCJcIiwgXCJcIiwgXCJcIiwgXCJcIl0sXG4gIGFjdGl2aXR5UGx1Z2luSWQ6IFwiYWN0aXZpdHlcIlxufTtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUmF6Ym9yUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IFJhemJvclNldHRpbmdzID0gREVGQVVMVF9TRVRUSU5HUztcbiAgcHJpdmF0ZSBhY3Rpb25CdXR0b25zID0gbmV3IE1hcDxNYXJrZG93blZpZXcsIEhUTUxFbGVtZW50PigpO1xuXG4gIGFzeW5jIG9ubG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuICAgIHRoaXMucmVnaXN0ZXJWaWV3KFZJRVdfVFlQRSwgKGxlYWYpID0+IG5ldyBSYXpib3JWaWV3KGxlYWYsIHRoaXMpKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFJhemJvclNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJvcGVuLWZvci1jdXJyZW50LW5vdGVcIixcbiAgICAgIG5hbWU6IFwiXHUwNDFFXHUwNDQyXHUwNDNBXHUwNDQwXHUwNDRCXHUwNDQyXHUwNDRDIFBhcnNpbmcgXHUwNDM0XHUwNDNCXHUwNDRGIFx1MDQ0Mlx1MDQzNVx1MDQzQVx1MDQ0M1x1MDQ0OVx1MDQzNVx1MDQzOSBcdTA0MzdcdTA0MzBcdTA0M0NcdTA0MzVcdTA0NDJcdTA0M0FcdTA0MzhcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICAgICAgaWYgKCF2aWV3Py5maWxlKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGlmICghY2hlY2tpbmcpIHZvaWQgdGhpcy5vcGVuRm9yRmlsZSh2aWV3LmZpbGUpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgKGxlYWYpID0+IHtcbiAgICAgIHRoaXMuYXR0YWNoSGVhZGVyQWN0aW9uKCk7XG4gICAgICBpZiAobGVhZj8udmlldyBpbnN0YW5jZW9mIFJhemJvclZpZXcpIGxlYWYudmlldy5hY3RpdmF0ZUtleWJvYXJkKCk7XG4gICAgfSkpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHRoaXMuYXR0YWNoSGVhZGVyQWN0aW9uKCkpO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmRldGFjaExlYXZlc09mVHlwZShWSUVXX1RZUEUpO1xuICAgIHRoaXMuYWN0aW9uQnV0dG9ucy5mb3JFYWNoKChidXR0b24pID0+IGJ1dHRvbi5yZW1vdmUoKSk7XG4gICAgdGhpcy5hY3Rpb25CdXR0b25zLmNsZWFyKCk7XG4gIH1cblxuICBwcml2YXRlIGF0dGFjaEhlYWRlckFjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcgfHwgdGhpcy5hY3Rpb25CdXR0b25zLmhhcyh2aWV3KSkgcmV0dXJuO1xuICAgIGNvbnN0IGJ1dHRvbiA9IHZpZXcuYWRkQWN0aW9uKFwibGlzdC1maWx0ZXJcIiwgXCJQYXJzaW5nOiBcdTA0NDBcdTA0MzBcdTA0MzdcdTA0M0VcdTA0MzFcdTA0NDBcdTA0MzBcdTA0NDJcdTA0NEMgXHUwNDQxXHUwNDQyXHUwNDQwXHUwNDNFXHUwNDNBXHUwNDM4IFx1MDQ0RFx1MDQ0Mlx1MDQzRVx1MDQzOSBcdTA0MzdcdTA0MzBcdTA0M0NcdTA0MzVcdTA0NDJcdTA0M0FcdTA0MzhcIiwgKCkgPT4ge1xuICAgICAgaWYgKHZpZXcuZmlsZSkgdm9pZCB0aGlzLm9wZW5Gb3JGaWxlKHZpZXcuZmlsZSk7XG4gICAgfSk7XG4gICAgYnV0dG9uLmFkZENsYXNzKFwicmF6Ym9yLWhlYWRlci1hY3Rpb25cIik7XG4gICAgdGhpcy5hY3Rpb25CdXR0b25zLnNldCh2aWV3LCBidXR0b24pO1xuICB9XG5cbiAgYXN5bmMgb3BlbkZvckZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBsZWFmID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYWYoXCJ0YWJcIik7XG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgdHlwZTogVklFV19UWVBFLFxuICAgICAgYWN0aXZlOiB0cnVlLFxuICAgICAgc3RhdGU6IHsgc291cmNlUGF0aDogZmlsZS5wYXRoIH1cbiAgICB9KTtcbiAgICBhd2FpdCB0aGlzLmFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcbiAgfVxuXG4gIGFzeW5jIGdldFNpZGVOb3Rlcyhzb3VyY2VQYXRoOiBzdHJpbmcpOiBQcm9taXNlPFRGaWxlW10+IHtcbiAgICBjb25zdCBzZWxlY3RlZDogVEZpbGVbXSA9IFtdO1xuICAgIGNvbnN0IHVzZWQgPSBuZXcgU2V0PHN0cmluZz4oW3NvdXJjZVBhdGhdKTtcblxuICAgIGZvciAoY29uc3QgY29uZmlndXJlZCBvZiB0aGlzLnNldHRpbmdzLnBpbm5lZE5vdGVzKSB7XG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5yZXNvbHZlTm90ZShjb25maWd1cmVkKTtcbiAgICAgIGlmIChmaWxlICYmICF1c2VkLmhhcyhmaWxlLnBhdGgpKSB7XG4gICAgICAgIHNlbGVjdGVkLnB1c2goZmlsZSk7XG4gICAgICAgIHVzZWQuYWRkKGZpbGUucGF0aCk7XG4gICAgICB9XG4gICAgICBpZiAoc2VsZWN0ZWQubGVuZ3RoID09PSA2KSByZXR1cm4gc2VsZWN0ZWQ7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBhd2FpdCB0aGlzLnJlYWRBY3Rpdml0eUVudHJpZXMoKSkge1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChub3JtYWxpemVQYXRoKGVudHJ5LnBhdGgpKTtcbiAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIiAmJiAhdXNlZC5oYXMoZmlsZS5wYXRoKSkge1xuICAgICAgICBzZWxlY3RlZC5wdXNoKGZpbGUpO1xuICAgICAgICB1c2VkLmFkZChmaWxlLnBhdGgpO1xuICAgICAgfVxuICAgICAgaWYgKHNlbGVjdGVkLmxlbmd0aCA9PT0gNikgcmV0dXJuIHNlbGVjdGVkO1xuICAgIH1cbiAgICByZXR1cm4gc2VsZWN0ZWQ7XG4gIH1cblxuICByZXNvbHZlTm90ZSh2YWx1ZTogc3RyaW5nKTogVEZpbGUgfCBudWxsIHtcbiAgICBjb25zdCBxdWVyeSA9IHZhbHVlLnRyaW0oKTtcbiAgICBpZiAoIXF1ZXJ5KSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBleGFjdFBhdGggPSBub3JtYWxpemVQYXRoKHF1ZXJ5LmVuZHNXaXRoKFwiLm1kXCIpID8gcXVlcnkgOiBgJHtxdWVyeX0ubWRgKTtcbiAgICBjb25zdCBleGFjdCA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChleGFjdFBhdGgpO1xuICAgIGlmIChleGFjdCBpbnN0YW5jZW9mIFRGaWxlKSByZXR1cm4gZXhhY3Q7XG4gICAgY29uc3QgbG93ZXIgPSBxdWVyeS5yZXBsYWNlKC9cXC5tZCQvaSwgXCJcIikudG9Mb2NhbGVMb3dlckNhc2UoKTtcbiAgICByZXR1cm4gdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLmZpbmQoKGZpbGUpID0+XG4gICAgICBmaWxlLmJhc2VuYW1lLnRvTG9jYWxlTG93ZXJDYXNlKCkgPT09IGxvd2VyIHx8XG4gICAgICBmaWxlLnBhdGgucmVwbGFjZSgvXFwubWQkL2ksIFwiXCIpLnRvTG9jYWxlTG93ZXJDYXNlKCkgPT09IGxvd2VyXG4gICAgKSA/PyBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkQWN0aXZpdHlFbnRyaWVzKCk6IFByb21pc2U8QWN0aXZpdHlFbnRyeVtdPiB7XG4gICAgY29uc3QgcGx1Z2lucyA9ICh0aGlzLmFwcCBhcyBBcHAgJiB7IHBsdWdpbnM/OiB7IHBsdWdpbnM/OiBSZWNvcmQ8c3RyaW5nLCBBY3Rpdml0eUFwaT4gfSB9KS5wbHVnaW5zPy5wbHVnaW5zO1xuICAgIGNvbnN0IGFjdGl2aXR5ID0gcGx1Z2lucz8uW3RoaXMuc2V0dGluZ3MuYWN0aXZpdHlQbHVnaW5JZF07XG4gICAgaWYgKCFhY3Rpdml0eSkgcmV0dXJuIFtdO1xuICAgIGNvbnN0IGFwaSA9IGFjdGl2aXR5LmFwaSA/PyBhY3Rpdml0eTtcbiAgICBsZXQgcmF3OiB1bmtub3duO1xuICAgIHRyeSB7XG4gICAgICByYXcgPSBhcGkuZ2V0VG9wTm90ZXMgPyBhd2FpdCBhcGkuZ2V0VG9wTm90ZXMoNDApXG4gICAgICAgIDogYXBpLmdldE1vc3RPcGVuZWROb3RlcyA/IGF3YWl0IGFwaS5nZXRNb3N0T3BlbmVkTm90ZXMoNDApXG4gICAgICAgIDogYXBpLmdldE5vdGVTdGF0cyA/IGF3YWl0IGFwaS5nZXROb3RlU3RhdHMoKVxuICAgICAgICA6IGFwaS5zdGF0cztcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIlBhcnNpbmc6IFx1MDQzRFx1MDQzNSBcdTA0NDNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0M0VcdTA0NDFcdTA0NEMgXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDQzXHUwNDQ3XHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQ0Mlx1MDQzOFx1MDQ0MVx1MDQ0Mlx1MDQzOFx1MDQzQVx1MDQ0MyBBY3Rpdml0eVwiLCBlcnJvcik7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICAgIHJldHVybiBub3JtYWxpemVBY3Rpdml0eUVudHJpZXMocmF3KTtcbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBkYXRhID0gKGF3YWl0IHRoaXMubG9hZERhdGEoKSkgYXMgUGFydGlhbDxSYXpib3JTZXR0aW5ncz4gfCBudWxsO1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBkYXRhID8/IHt9KTtcbiAgICB0aGlzLnNldHRpbmdzLnBpbm5lZE5vdGVzID0gWy4uLih0aGlzLnNldHRpbmdzLnBpbm5lZE5vdGVzID8/IFtdKV0uc2xpY2UoMCwgNik7XG4gICAgd2hpbGUgKHRoaXMuc2V0dGluZ3MucGlubmVkTm90ZXMubGVuZ3RoIDwgNikgdGhpcy5zZXR0aW5ncy5waW5uZWROb3Rlcy5wdXNoKFwiXCIpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gICAgYXdhaXQgdGhpcy5yZWZyZXNoVmlld3MoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaFZpZXdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRSkpIHtcbiAgICAgIGlmIChsZWFmLnZpZXcgaW5zdGFuY2VvZiBSYXpib3JWaWV3KSBhd2FpdCBsZWFmLnZpZXcucmVmcmVzaFNpZGVOb3RlcygpO1xuICAgIH1cbiAgfVxufVxuXG5jbGFzcyBSYXpib3JWaWV3IGV4dGVuZHMgSXRlbVZpZXcge1xuICBwcml2YXRlIHNvdXJjZVBhdGggPSBcIlwiO1xuICBwcml2YXRlIGxpbmVzOiBSZXZpZXdMaW5lW10gPSBbXTtcbiAgcHJpdmF0ZSBpbmRleCA9IDA7XG4gIHByaXZhdGUgc2lkZU5vdGVzOiBURmlsZVtdID0gW107XG4gIHByaXZhdGUgaW5wdXRFbDogSFRNTElucHV0RWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN1Z2dlc3Rpb25FbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBsaW5lRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY3JlYXRlTm90ZVJvd0VsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNyZWF0ZU5vdGVJbnB1dEVsOiBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcHJvZ3Jlc3NFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwcmV2aW91c0J1dHRvbjogSFRNTEJ1dHRvbkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBuZXh0QnV0dG9uOiBIVE1MQnV0dG9uRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNpZGVCdXR0b25zOiBIVE1MQnV0dG9uRWxlbWVudFtdID0gW107XG4gIHByaXZhdGUgdmlzaWJsZVJlc3VsdHM6IFRGaWxlW10gPSBbXTtcbiAgcHJpdmF0ZSBzZWFyY2hSZXF1ZXN0ID0gMDtcbiAgcHJpdmF0ZSBrZXlIYW5kbGVyID0gKGV2ZW50OiBLZXlib2FyZEV2ZW50KSA9PiB0aGlzLm9uS2V5RG93bihldmVudCk7XG5cbiAgY29uc3RydWN0b3IobGVhZjogV29ya3NwYWNlTGVhZiwgcHJpdmF0ZSBwbHVnaW46IFJhemJvclBsdWdpbikge1xuICAgIHN1cGVyKGxlYWYpO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKTogc3RyaW5nIHsgcmV0dXJuIFZJRVdfVFlQRTsgfVxuICBnZXREaXNwbGF5VGV4dCgpOiBzdHJpbmcgeyByZXR1cm4gXCJQYXJzaW5nXCI7IH1cbiAgZ2V0SWNvbigpOiBzdHJpbmcgeyByZXR1cm4gXCJsaXN0LWZpbHRlclwiOyB9XG5cbiAgYXN5bmMgc2V0U3RhdGUoc3RhdGU6IHsgc291cmNlUGF0aD86IHN0cmluZyB9LCByZXN1bHQ6IFZpZXdTdGF0ZVJlc3VsdCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc291cmNlUGF0aCA9IHN0YXRlLnNvdXJjZVBhdGggPz8gXCJcIjtcbiAgICBhd2FpdCBzdXBlci5zZXRTdGF0ZShzdGF0ZSwgcmVzdWx0KTtcbiAgICBpZiAodGhpcy5jb250YWluZXJFbC5pc0Nvbm5lY3RlZCkgYXdhaXQgdGhpcy5sb2FkU291cmNlKCk7XG4gIH1cblxuICBnZXRTdGF0ZSgpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7IHJldHVybiB7IHNvdXJjZVBhdGg6IHRoaXMuc291cmNlUGF0aCB9OyB9XG5cbiAgYXN5bmMgb25PcGVuKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIHRoaXMua2V5SGFuZGxlciwgdHJ1ZSk7XG4gICAgYXdhaXQgdGhpcy5sb2FkU291cmNlKCk7XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIHRoaXMua2V5SGFuZGxlciwgdHJ1ZSk7XG4gIH1cblxuICBhY3RpdmF0ZUtleWJvYXJkKCk6IHZvaWQge1xuICAgIHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGlmICh0aGlzLmlzQWN0aXZlVmlldygpKSB0aGlzLmlucHV0RWw/LmZvY3VzKCk7XG4gICAgfSwgMCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWRTb3VyY2UoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRoaXMuc291cmNlUGF0aCk7XG4gICAgaWYgKCEoc291cmNlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICB0aGlzLnJlbmRlckVycm9yKFwiXHUwNDE4XHUwNDQxXHUwNDQ1XHUwNDNFXHUwNDM0XHUwNDNEXHUwNDMwXHUwNDRGIFx1MDQzN1x1MDQzMFx1MDQzQ1x1MDQzNVx1MDQ0Mlx1MDQzQVx1MDQzMCBcdTA0M0RcdTA0MzUgXHUwNDNEXHUwNDMwXHUwNDM5XHUwNDM0XHUwNDM1XHUwNDNEXHUwNDMwXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChzb3VyY2UpO1xuICAgIHRoaXMubGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLykubWFwKChvcmlnaW5hbCwgbGluZU51bWJlcikgPT4ge1xuICAgICAgY29uc3QgdGV4dCA9IG9yaWdpbmFsLnRyaW0oKTtcbiAgICAgIGNvbnN0IGRpcmVjdCA9IHRoaXMucGFyc2VEaXJlY3RUYXJnZXQodGV4dCk7XG4gICAgICByZXR1cm4geyB0ZXh0LCBvcmlnaW5hbCwgbGluZU51bWJlciwgLi4uZGlyZWN0IH07XG4gICAgfSkuZmlsdGVyKChsaW5lKSA9PiBsaW5lLnRleHQubGVuZ3RoID4gMCk7XG4gICAgdGhpcy5pbmRleCA9IDA7XG4gICAgdGhpcy5zaWRlTm90ZXMgPSBhd2FpdCB0aGlzLnBsdWdpbi5nZXRTaWRlTm90ZXModGhpcy5zb3VyY2VQYXRoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgYXN5bmMgcmVmcmVzaFNpZGVOb3RlcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNpZGVOb3RlcyA9IGF3YWl0IHRoaXMucGx1Z2luLmdldFNpZGVOb3Rlcyh0aGlzLnNvdXJjZVBhdGgpO1xuICAgIGlmICh0aGlzLmNvbnRhaW5lckVsLmlzQ29ubmVjdGVkKSB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBwYXJzZURpcmVjdFRhcmdldCh0ZXh0OiBzdHJpbmcpOiBQaWNrPFJldmlld0xpbmUsIFwiZGlyZWN0VGFyZ2V0XCIgfCBcImRpcmVjdFRleHRcIj4ge1xuICAgIGNvbnN0IHNlcGFyYXRvcnMgPSBbXCJcdTIwMTNcIiwgXCJcdTIwMTRcIl0gYXMgY29uc3Q7XG4gICAgY29uc3QgcG9zaXRpb25zID0gc2VwYXJhdG9yc1xuICAgICAgLm1hcCgoc2VwYXJhdG9yKSA9PiAoeyBzZXBhcmF0b3IsIHBvc2l0aW9uOiB0ZXh0LmluZGV4T2Yoc2VwYXJhdG9yKSB9KSlcbiAgICAgIC5maWx0ZXIoKHsgcG9zaXRpb24gfSkgPT4gcG9zaXRpb24gPiAwKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IGEucG9zaXRpb24gLSBiLnBvc2l0aW9uKTtcbiAgICBpZiAocG9zaXRpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9O1xuICAgIGNvbnN0IHsgc2VwYXJhdG9yLCBwb3NpdGlvbiB9ID0gcG9zaXRpb25zWzBdO1xuICAgIGNvbnN0IHRpdGxlID0gdGV4dC5zbGljZSgwLCBwb3NpdGlvbikudHJpbSgpO1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLnBsdWdpbi5yZXNvbHZlTm90ZSh0aXRsZSk7XG4gICAgaWYgKGZpbGUpIHJldHVybiB7IGRpcmVjdFRhcmdldDogZmlsZS5wYXRoLCBkaXJlY3RUZXh0OiB0ZXh0LnNsaWNlKHBvc2l0aW9uICsgc2VwYXJhdG9yLmxlbmd0aCkudHJpbSgpIH07XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXIoKTogdm9pZCB7XG4gICAgY29uc3QgY29udGVudCA9IHRoaXMuY29udGVudEVsO1xuICAgIGNvbnRlbnQuZW1wdHkoKTtcbiAgICBjb250ZW50LmFkZENsYXNzKFwicmF6Ym9yLXZpZXdcIik7XG4gICAgdGhpcy5zaWRlQnV0dG9ucyA9IFtdO1xuXG4gICAgY29uc3Qgc2hlbGwgPSBjb250ZW50LmNyZWF0ZURpdih7IGNsczogXCJyYXpib3Itc2hlbGxcIiB9KTtcbiAgICBjb25zdCBoZWFkZXIgPSBzaGVsbC5jcmVhdGVEaXYoeyBjbHM6IFwicmF6Ym9yLXRvcFwiIH0pO1xuICAgIGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwicmF6Ym9yLXRpdGxlXCIsIHRleHQ6IFwiUEFSU0lOR1wiIH0pO1xuICAgIHRoaXMucHJvZ3Jlc3NFbCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwicmF6Ym9yLXByb2dyZXNzXCIgfSk7XG5cbiAgICBjb25zdCBsaW5lU3RhZ2UgPSBzaGVsbC5jcmVhdGVEaXYoeyBjbHM6IFwicmF6Ym9yLWxpbmUtc3RhZ2VcIiB9KTtcbiAgICB0aGlzLnByZXZpb3VzQnV0dG9uID0gdGhpcy5jcmVhdGVOYXZpZ2F0aW9uQnV0dG9uKFxuICAgICAgbGluZVN0YWdlLFxuICAgICAgXCJsZWZ0XCIsXG4gICAgICBcIlx1MDQxRlx1MDQ0MFx1MDQzNVx1MDQzNFx1MDQ0Qlx1MDQzNFx1MDQ0M1x1MDQ0OVx1MDQzMFx1MDQ0RiBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0M0VcdTA0M0FcdTA0MzBcIixcbiAgICAgIFwiQ3RybCtTaGlmdCtIXCIsXG4gICAgICAoKSA9PiB0aGlzLm5hdmlnYXRlKC0xKVxuICAgICk7XG4gICAgY29uc3QgbGluZUNvbHVtbiA9IGxpbmVTdGFnZS5jcmVhdGVEaXYoeyBjbHM6IFwicmF6Ym9yLWxpbmUtY29sdW1uXCIgfSk7XG4gICAgdGhpcy5jcmVhdGVOb3RlUm93RWwgPSBsaW5lQ29sdW1uLmNyZWF0ZURpdih7IGNsczogXCJyYXpib3ItY3JlYXRlLW5vdGUtcm93XCIgfSk7XG4gICAgdGhpcy5saW5lRWwgPSBsaW5lQ29sdW1uLmNyZWF0ZURpdih7IGNsczogXCJyYXpib3ItbGluZS1jYXJkXCIgfSk7XG4gICAgdGhpcy5uZXh0QnV0dG9uID0gdGhpcy5jcmVhdGVOYXZpZ2F0aW9uQnV0dG9uKFxuICAgICAgbGluZVN0YWdlLFxuICAgICAgXCJyaWdodFwiLFxuICAgICAgXCJcdTA0MjFcdTA0M0JcdTA0MzVcdTA0MzRcdTA0NDNcdTA0NEVcdTA0NDlcdTA0MzBcdTA0NEYgXHUwNDQxXHUwNDQyXHUwNDQwXHUwNDNFXHUwNDNBXHUwNDMwXCIsXG4gICAgICBcIkN0cmwrU2hpZnQrTFwiLFxuICAgICAgKCkgPT4gdGhpcy5uYXZpZ2F0ZSgxKVxuICAgICk7XG4gICAgY29uc3QgY29udHJvbHMgPSBzaGVsbC5jcmVhdGVEaXYoeyBjbHM6IFwicmF6Ym9yLWNvbnRyb2xzXCIgfSk7XG4gICAgY29uc3QgbGVmdCA9IGNvbnRyb2xzLmNyZWF0ZURpdih7IGNsczogXCJyYXpib3Itc2lkZSByYXpib3Itc2lkZS1sZWZ0XCIgfSk7XG4gICAgY29uc3QgY2VudGVyID0gY29udHJvbHMuY3JlYXRlRGl2KHsgY2xzOiBcInJhemJvci1jZW50ZXJcIiB9KTtcbiAgICBjb25zdCByaWdodCA9IGNvbnRyb2xzLmNyZWF0ZURpdih7IGNsczogXCJyYXpib3Itc2lkZSByYXpib3Itc2lkZS1yaWdodFwiIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJTaWRlKGxlZnQsIHRoaXMuc2lkZU5vdGVzLnNsaWNlKDAsIDMpLCAwKTtcbiAgICB0aGlzLnJlbmRlclNpZGUocmlnaHQsIHRoaXMuc2lkZU5vdGVzLnNsaWNlKDMsIDYpLCAzKTtcblxuICAgIHRoaXMuaW5wdXRFbCA9IGNlbnRlci5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgIGNsczogXCJyYXpib3Itc2VhcmNoXCIsXG4gICAgICBhdHRyOiB7IHR5cGU6IFwidGV4dFwiLCBwbGFjZWhvbGRlcjogXCJcdTA0MUFcdTA0NDNcdTA0MzRcdTA0MzAgXHUwNDNFXHUwNDQyXHUwNDNGXHUwNDQwXHUwNDMwXHUwNDMyXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzQVx1MDQ0M1x1MjAyNlwiLCBhdXRvY29tcGxldGU6IFwib2ZmXCIsIHNwZWxsY2hlY2s6IFwiZmFsc2VcIiB9XG4gICAgfSk7XG4gICAgdGhpcy5zdWdnZXN0aW9uRWwgPSBjZW50ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInJhemJvci1zdWdnZXN0aW9uc1wiIH0pO1xuICAgIHRoaXMuaW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4gdm9pZCB0aGlzLnJlbmRlclN1Z2dlc3Rpb25zKCkpO1xuICAgIHRoaXMuaW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICB2b2lkIHRoaXMuc2VuZEJ5RW50ZXIoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRoaXMudXBkYXRlQ3VycmVudExpbmUoKTtcbiAgICB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0aGlzLmlucHV0RWw/LmZvY3VzKCksIDApO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVOYXZpZ2F0aW9uQnV0dG9uKFxuICAgIGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsXG4gICAgZGlyZWN0aW9uOiBcImxlZnRcIiB8IFwicmlnaHRcIixcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHNob3J0Y3V0OiBzdHJpbmcsXG4gICAgY2FsbGJhY2s6ICgpID0+IHZvaWRcbiAgKTogSFRNTEJ1dHRvbkVsZW1lbnQge1xuICAgIGNvbnN0IGJ1dHRvbiA9IGNvbnRhaW5lci5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IGByYXpib3ItbmF2LWJ1dHRvbiByYXpib3ItbmF2LSR7ZGlyZWN0aW9ufWAsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBgJHtsYWJlbH0gKCR7c2hvcnRjdXR9KWAsIHRpdGxlOiBgJHtsYWJlbH0gXHUyMDE0ICR7c2hvcnRjdXR9YCB9XG4gICAgfSk7XG4gICAgc2V0SWNvbihidXR0b24sIGRpcmVjdGlvbiA9PT0gXCJsZWZ0XCIgPyBcImNoZXZyb24tbGVmdFwiIDogXCJjaGV2cm9uLXJpZ2h0XCIpO1xuICAgIGJ1dHRvbi5jcmVhdGVTcGFuKHsgY2xzOiBcInJhemJvci1uYXYta2V5XCIsIHRleHQ6IHNob3J0Y3V0IH0pO1xuICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgY2FsbGJhY2spO1xuICAgIHJldHVybiBidXR0b247XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclNpZGUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgZmlsZXM6IFRGaWxlW10sIG9mZnNldDogbnVtYmVyKTogdm9pZCB7XG4gICAgZm9yIChsZXQgbG9jYWxJbmRleCA9IDA7IGxvY2FsSW5kZXggPCAzOyBsb2NhbEluZGV4KyspIHtcbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlc1tsb2NhbEluZGV4XTtcbiAgICAgIGNvbnN0IHNob3J0Y3V0SW5kZXggPSBvZmZzZXQgKyBsb2NhbEluZGV4O1xuICAgICAgY29uc3QgYnV0dG9uID0gY29udGFpbmVyLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcInJhemJvci1ub3RlLWJ1dHRvblwiIH0pO1xuICAgICAgYnV0dG9uLmRhdGFzZXQuaW5kZXggPSBTdHJpbmcoc2hvcnRjdXRJbmRleCk7XG4gICAgICBjb25zdCBrZXkgPSBidXR0b24uY3JlYXRlU3Bhbih7IGNsczogXCJyYXpib3Ita2V5XCIsIHRleHQ6IGBDdHJsK1NoaWZ0KyR7U0hPUlRDVVRTW3Nob3J0Y3V0SW5kZXhdfWAgfSk7XG4gICAgICBrZXkuc2V0QXR0cihcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcbiAgICAgIGNvbnN0IGljb24gPSBidXR0b24uY3JlYXRlU3Bhbih7IGNsczogXCJyYXpib3Itbm90ZS1pY29uXCIgfSk7XG4gICAgICBzZXRJY29uKGljb24sIFwiZmlsZS10ZXh0XCIpO1xuICAgICAgYnV0dG9uLmNyZWF0ZVNwYW4oeyBjbHM6IFwicmF6Ym9yLW5vdGUtbmFtZVwiLCB0ZXh0OiBmaWxlPy5iYXNlbmFtZSA/PyBcIlx1MDQxRFx1MDQzNSBcdTA0M0RcdTA0MzBcdTA0MzdcdTA0M0RcdTA0MzBcdTA0NDdcdTA0MzVcdTA0M0RcdTA0M0VcIiB9KTtcbiAgICAgIGJ1dHRvbi5kaXNhYmxlZCA9ICFmaWxlO1xuICAgICAgaWYgKGZpbGUpIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdm9pZCB0aGlzLmFzc2lnbihmaWxlKSk7XG4gICAgICB0aGlzLnNpZGVCdXR0b25zW3Nob3J0Y3V0SW5kZXhdID0gYnV0dG9uO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlQ3VycmVudExpbmUoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmxpbmVFbCB8fCAhdGhpcy5wcm9ncmVzc0VsKSByZXR1cm47XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMubGluZXNbdGhpcy5pbmRleF07XG4gICAgdGhpcy5saW5lRWwuZW1wdHkoKTtcbiAgICB0aGlzLmNsb3NlQ3JlYXRlTm90ZUlucHV0KGZhbHNlKTtcbiAgICB0aGlzLnByb2dyZXNzRWwuc2V0VGV4dChgJHtNYXRoLm1pbih0aGlzLmluZGV4ICsgMSwgdGhpcy5saW5lcy5sZW5ndGgpfSAvICR7dGhpcy5saW5lcy5sZW5ndGh9YCk7XG4gICAgaWYgKCFjdXJyZW50KSB7XG4gICAgICB0aGlzLmxpbmVFbC5hZGRDbGFzcyhcImlzLWZpbmlzaGVkXCIpO1xuICAgICAgdGhpcy5saW5lRWwuY3JlYXRlRGl2KHsgY2xzOiBcInJhemJvci1maW5pc2hlZFwiLCB0ZXh0OiBcIlx1MDQxMlx1MDQ0MVx1MDQzNSBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0M0VcdTA0M0FcdTA0MzggXHUwNDQwXHUwNDMwXHUwNDM3XHUwNDNFXHUwNDMxXHUwNDQwXHUwNDMwXHUwNDNEXHUwNDRCXCIgfSk7XG4gICAgICBpZiAodGhpcy5pbnB1dEVsKSB0aGlzLmlucHV0RWwuZGlzYWJsZWQgPSB0cnVlO1xuICAgICAgdGhpcy51cGRhdGVOYXZpZ2F0aW9uQnV0dG9ucygpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmxpbmVFbC5yZW1vdmVDbGFzcyhcImlzLWZpbmlzaGVkXCIpO1xuICAgIGNvbnN0IGNyZWF0ZUJ1dHRvbiA9IHRoaXMubGluZUVsLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJyYXpib3ItY3JlYXRlLWJ1dHRvblwiLFxuICAgICAgYXR0cjoge1xuICAgICAgICBcImFyaWEtbGFiZWxcIjogXCJcdTA0MjFcdTA0M0VcdTA0MzdcdTA0MzRcdTA0MzBcdTA0NDJcdTA0NEMgXHUwNDM3XHUwNDMwXHUwNDNDXHUwNDM1XHUwNDQyXHUwNDNBXHUwNDQzIChDdHJsK1NoaWZ0K0VudGVyKVwiLFxuICAgICAgICB0aXRsZTogXCJcdTA0MjFcdTA0M0VcdTA0MzdcdTA0MzRcdTA0MzBcdTA0NDJcdTA0NEMgXHUwNDM3XHUwNDMwXHUwNDNDXHUwNDM1XHUwNDQyXHUwNDNBXHUwNDQzIFx1MjAxNCBDdHJsK1NoaWZ0K0VudGVyXCJcbiAgICAgIH1cbiAgICB9KTtcbiAgICBzZXRJY29uKGNyZWF0ZUJ1dHRvbiwgXCJmaWxlLXBsdXMtMlwiKTtcbiAgICBjcmVhdGVCdXR0b24uY3JlYXRlU3Bhbih7IGNsczogXCJyYXpib3ItY3JlYXRlLWtleVwiLCB0ZXh0OiBcIkN0cmwrU2hpZnQrRW50ZXJcIiB9KTtcbiAgICBjcmVhdGVCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlbkNyZWF0ZU5vdGVJbnB1dCgpKTtcbiAgICBjb25zdCBkZWxldGVCdXR0b24gPSB0aGlzLmxpbmVFbC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwicmF6Ym9yLWRlbGV0ZS1idXR0b25cIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzQVx1MDQ0MyAoQ3RybCtTaGlmdCtCYWNrc3BhY2UpXCIsXG4gICAgICAgIHRpdGxlOiBcIlx1MDQyM1x1MDQzNFx1MDQzMFx1MDQzQlx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0M0VcdTA0M0FcdTA0NDMgXHUyMDE0IEN0cmwrU2hpZnQrQmFja3NwYWNlXCJcbiAgICAgIH1cbiAgICB9KTtcbiAgICBzZXRJY29uKGRlbGV0ZUJ1dHRvbiwgXCJ0cmFzaC0yXCIpO1xuICAgIGRlbGV0ZUJ1dHRvbi5jcmVhdGVTcGFuKHsgY2xzOiBcInJhemJvci1kZWxldGUta2V5XCIsIHRleHQ6IFwiQ3RybCtTaGlmdCtCYWNrc3BhY2VcIiB9KTtcbiAgICBkZWxldGVCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHZvaWQgdGhpcy5kZWxldGVDdXJyZW50TGluZSgpKTtcbiAgICB0aGlzLmxpbmVFbC5jcmVhdGVEaXYoeyBjbHM6IFwicmF6Ym9yLWxpbmUtdGV4dFwiLCB0ZXh0OiBjdXJyZW50LnRleHQgfSk7XG4gICAgaWYgKGN1cnJlbnQuZGlyZWN0VGFyZ2V0KSB7XG4gICAgICBjb25zdCB0YXJnZXQgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoY3VycmVudC5kaXJlY3RUYXJnZXQpO1xuICAgICAgdGhpcy5saW5lRWwuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcInJhemJvci1kaXJlY3QtaGludFwiLFxuICAgICAgICB0ZXh0OiBgRW50ZXIgXHUyMTkyICR7dGFyZ2V0IGluc3RhbmNlb2YgVEZpbGUgPyB0YXJnZXQuYmFzZW5hbWUgOiBjdXJyZW50LmRpcmVjdFRhcmdldH1gXG4gICAgICB9KTtcbiAgICAgIGlmICh0aGlzLmlucHV0RWwpIHRoaXMuaW5wdXRFbC5wbGFjZWhvbGRlciA9IFwiRW50ZXIgXHUwNDNFXHUwNDQyXHUwNDNGXHUwNDQwXHUwNDMwXHUwNDMyXHUwNDM4XHUwNDQyIFx1MDQzRlx1MDQzRSBcdTA0NDNcdTA0M0FcdTA0MzBcdTA0MzdcdTA0MzBcdTA0M0RcdTA0M0RcdTA0M0VcdTA0M0NcdTA0NDMgXHUwNDNEXHUwNDMwXHUwNDM3XHUwNDMyXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDRFXCI7XG4gICAgfSBlbHNlIGlmICh0aGlzLmlucHV0RWwpIHtcbiAgICAgIHRoaXMuaW5wdXRFbC5wbGFjZWhvbGRlciA9IFwiXHUwNDFBXHUwNDQzXHUwNDM0XHUwNDMwIFx1MDQzRVx1MDQ0Mlx1MDQzRlx1MDQ0MFx1MDQzMFx1MDQzMlx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0M0VcdTA0M0FcdTA0NDNcdTIwMjZcIjtcbiAgICB9XG4gICAgaWYgKHRoaXMuaW5wdXRFbCkgdGhpcy5pbnB1dEVsLnZhbHVlID0gXCJcIjtcbiAgICBpZiAodGhpcy5pbnB1dEVsKSB0aGlzLmlucHV0RWwuZGlzYWJsZWQgPSBmYWxzZTtcbiAgICB0aGlzLnVwZGF0ZU5hdmlnYXRpb25CdXR0b25zKCk7XG4gICAgdm9pZCB0aGlzLnJlbmRlclN1Z2dlc3Rpb25zKCk7XG4gIH1cblxuICBwcml2YXRlIG9wZW5DcmVhdGVOb3RlSW5wdXQoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmxpbmVzW3RoaXMuaW5kZXhdIHx8ICF0aGlzLmNyZWF0ZU5vdGVSb3dFbCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLmNyZWF0ZU5vdGVJbnB1dEVsKSB7XG4gICAgICB0aGlzLmNyZWF0ZU5vdGVJbnB1dEVsLmZvY3VzKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlTm90ZVJvd0VsLmVtcHR5KCk7XG4gICAgdGhpcy5jcmVhdGVOb3RlUm93RWwuYWRkQ2xhc3MoXCJpcy1vcGVuXCIpO1xuICAgIHRoaXMuY3JlYXRlTm90ZUlucHV0RWwgPSB0aGlzLmNyZWF0ZU5vdGVSb3dFbC5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgIGNsczogXCJyYXpib3ItY3JlYXRlLW5vdGUtaW5wdXRcIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgIHBsYWNlaG9sZGVyOiBcIlx1MDQxRFx1MDQzMFx1MDQzN1x1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzNSBcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0VcdTA0MzkgXHUwNDM3XHUwNDMwXHUwNDNDXHUwNDM1XHUwNDQyXHUwNDNBXHUwNDM4XHUyMDI2XCIsXG4gICAgICAgIGF1dG9jb21wbGV0ZTogXCJvZmZcIixcbiAgICAgICAgc3BlbGxjaGVjazogXCJmYWxzZVwiXG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5jcmVhdGVOb3RlSW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZXZlbnQuY3RybEtleSAmJiAhZXZlbnQuYWx0S2V5ICYmICFldmVudC5tZXRhS2V5KSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICB2b2lkIHRoaXMuY3JlYXRlTm90ZUFuZEFzc2lnbigpO1xuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIHRoaXMuY2xvc2VDcmVhdGVOb3RlSW5wdXQoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB0aGlzLmNyZWF0ZU5vdGVJbnB1dEVsLmZvY3VzKCk7XG4gIH1cblxuICBwcml2YXRlIGNsb3NlQ3JlYXRlTm90ZUlucHV0KGZvY3VzU2VhcmNoID0gdHJ1ZSk6IHZvaWQge1xuICAgIHRoaXMuY3JlYXRlTm90ZUlucHV0RWwgPSBudWxsO1xuICAgIHRoaXMuY3JlYXRlTm90ZVJvd0VsPy5lbXB0eSgpO1xuICAgIHRoaXMuY3JlYXRlTm90ZVJvd0VsPy5yZW1vdmVDbGFzcyhcImlzLW9wZW5cIik7XG4gICAgaWYgKGZvY3VzU2VhcmNoKSB0aGlzLmlucHV0RWw/LmZvY3VzKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNyZWF0ZU5vdGVBbmRBc3NpZ24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMubGluZXNbdGhpcy5pbmRleF07XG4gICAgY29uc3QgcmF3TmFtZSA9IHRoaXMuY3JlYXRlTm90ZUlucHV0RWw/LnZhbHVlLnRyaW0oKSA/PyBcIlwiO1xuICAgIGlmICghY3VycmVudCB8fCAhcmF3TmFtZSkge1xuICAgICAgbmV3IE5vdGljZShcIlx1MDQxMlx1MDQzMlx1MDQzNVx1MDQzNFx1MDQzOFx1MDQ0Mlx1MDQzNSBcdTA0M0RcdTA0MzBcdTA0MzdcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzhcdTA0MzUgXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDNFXHUwNDM5IFx1MDQzN1x1MDQzMFx1MDQzQ1x1MDQzNVx1MDQ0Mlx1MDQzQVx1MDQzOFwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgd2l0aG91dEV4dGVuc2lvbiA9IHJhd05hbWUucmVwbGFjZSgvXFwubWQkL2ksIFwiXCIpLnRyaW0oKTtcbiAgICBpZiAoIXdpdGhvdXRFeHRlbnNpb24gfHwgL1tcXFxcOio/XCI8PnxdLy50ZXN0KHdpdGhvdXRFeHRlbnNpb24pKSB7XG4gICAgICBuZXcgTm90aWNlKFwiXHUwNDEyIFx1MDQzRFx1MDQzMFx1MDQzN1x1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzOCBcdTA0MzdcdTA0MzBcdTA0M0NcdTA0MzVcdTA0NDJcdTA0M0FcdTA0MzggXHUwNDM1XHUwNDQxXHUwNDQyXHUwNDRDIFx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzRVx1MDQzRlx1MDQ0M1x1MDQ0MVx1MDQ0Mlx1MDQzOFx1MDQzQ1x1MDQ0Qlx1MDQzNSBcdTA0NDFcdTA0MzhcdTA0M0NcdTA0MzJcdTA0M0VcdTA0M0JcdTA0NEJcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHBhdGggPSBub3JtYWxpemVQYXRoKGAke3dpdGhvdXRFeHRlbnNpb259Lm1kYCk7XG4gICAgaWYgKHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKSkge1xuICAgICAgbmV3IE5vdGljZShcIlx1MDQxN1x1MDQzMFx1MDQzQ1x1MDQzNVx1MDQ0Mlx1MDQzQVx1MDQzMCBcdTA0NDEgXHUwNDQyXHUwNDMwXHUwNDNBXHUwNDM4XHUwNDNDIFx1MDQzOFx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzNVx1MDQzQyBcdTA0NDNcdTA0MzZcdTA0MzUgXHUwNDQxXHUwNDQzXHUwNDQ5XHUwNDM1XHUwNDQxXHUwNDQyXHUwNDMyXHUwNDQzXHUwNDM1XHUwNDQyXCIpO1xuICAgICAgdGhpcy5jcmVhdGVOb3RlSW5wdXRFbD8uZm9jdXMoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcmVudFBhdGggPSBwYXRoLmluY2x1ZGVzKFwiL1wiKSA/IHBhdGguc2xpY2UoMCwgcGF0aC5sYXN0SW5kZXhPZihcIi9cIikpIDogXCJcIjtcbiAgICAgIGlmIChwYXJlbnRQYXRoKSBhd2FpdCB0aGlzLmVuc3VyZUZvbGRlcihwYXJlbnRQYXRoKTtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBgJHtjdXJyZW50LnRleHR9XFxuYCk7XG4gICAgICBhd2FpdCB0aGlzLnJlbW92ZUZyb21Tb3VyY2UoY3VycmVudC5vcmlnaW5hbCk7XG4gICAgICB0aGlzLmNsb3NlQ3JlYXRlTm90ZUlucHV0KGZhbHNlKTtcbiAgICAgIHRoaXMucmVtb3ZlQ3VycmVudEZyb21RdWV1ZSgpO1xuICAgICAgdGhpcy51cGRhdGVDdXJyZW50TGluZSgpO1xuICAgICAgdGhpcy5pbnB1dEVsPy5mb2N1cygpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiUGFyc2luZzogXHUwNDNFXHUwNDQ4XHUwNDM4XHUwNDMxXHUwNDNBXHUwNDMwIFx1MDQ0MVx1MDQzRVx1MDQzN1x1MDQzNFx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RiBcdTA0MzdcdTA0MzBcdTA0M0NcdTA0MzVcdTA0NDJcdTA0M0FcdTA0MzhcIiwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShcIlx1MDQxRFx1MDQzNSBcdTA0NDNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0M0VcdTA0NDFcdTA0NEMgXHUwNDQxXHUwNDNFXHUwNDM3XHUwNDM0XHUwNDMwXHUwNDQyXHUwNDRDIFx1MDQzN1x1MDQzMFx1MDQzQ1x1MDQzNVx1MDQ0Mlx1MDQzQVx1MDQ0M1wiKTtcbiAgICAgIHRoaXMuY3JlYXRlTm90ZUlucHV0RWw/LmZvY3VzKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVGb2xkZXIoZm9sZGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcGFydHMgPSBub3JtYWxpemVQYXRoKGZvbGRlclBhdGgpLnNwbGl0KFwiL1wiKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgbGV0IGN1cnJlbnQgPSBcIlwiO1xuICAgIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgICAgY3VycmVudCA9IGN1cnJlbnQgPyBgJHtjdXJyZW50fS8ke3BhcnR9YCA6IHBhcnQ7XG4gICAgICBpZiAoIXRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChjdXJyZW50KSkgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKGN1cnJlbnQpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbmF2aWdhdGUob2Zmc2V0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBuZXh0SW5kZXggPSB0aGlzLmluZGV4ICsgb2Zmc2V0O1xuICAgIGlmIChuZXh0SW5kZXggPCAwIHx8IG5leHRJbmRleCA+PSB0aGlzLmxpbmVzLmxlbmd0aCkgcmV0dXJuO1xuICAgIHRoaXMuaW5kZXggPSBuZXh0SW5kZXg7XG4gICAgdGhpcy51cGRhdGVDdXJyZW50TGluZSgpO1xuICAgIHRoaXMuaW5wdXRFbD8uZm9jdXMoKTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlTmF2aWdhdGlvbkJ1dHRvbnMoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucHJldmlvdXNCdXR0b24pIHRoaXMucHJldmlvdXNCdXR0b24uZGlzYWJsZWQgPSB0aGlzLmluZGV4IDw9IDAgfHwgdGhpcy5saW5lcy5sZW5ndGggPT09IDA7XG4gICAgaWYgKHRoaXMubmV4dEJ1dHRvbikgdGhpcy5uZXh0QnV0dG9uLmRpc2FibGVkID0gdGhpcy5pbmRleCA+PSB0aGlzLmxpbmVzLmxlbmd0aCAtIDEgfHwgdGhpcy5saW5lcy5sZW5ndGggPT09IDA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlbmRlclN1Z2dlc3Rpb25zKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zdWdnZXN0aW9uRWwpIHJldHVybjtcbiAgICBjb25zdCByZXF1ZXN0ID0gKyt0aGlzLnNlYXJjaFJlcXVlc3Q7XG4gICAgdGhpcy5zdWdnZXN0aW9uRWwuZW1wdHkoKTtcbiAgICB0aGlzLnZpc2libGVSZXN1bHRzID0gW107XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMubGluZXNbdGhpcy5pbmRleF07XG4gICAgaWYgKCFjdXJyZW50KSByZXR1cm47XG4gICAgaWYgKGN1cnJlbnQuZGlyZWN0VGFyZ2V0ICYmICF0aGlzLmlucHV0RWw/LnZhbHVlLnRyaW0oKSkge1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChjdXJyZW50LmRpcmVjdFRhcmdldCk7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgIHRoaXMudmlzaWJsZVJlc3VsdHMgPSBbZmlsZV07XG4gICAgICAgIHRoaXMuY3JlYXRlU3VnZ2VzdGlvbihmaWxlLCB0cnVlKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLmlucHV0RWw/LnZhbHVlID8/IFwiXCI7XG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuZ2V0U2VhcmNoUmVzdWx0cyhxdWVyeSk7XG4gICAgaWYgKHJlcXVlc3QgIT09IHRoaXMuc2VhcmNoUmVxdWVzdCB8fCAhdGhpcy5zdWdnZXN0aW9uRWwpIHJldHVybjtcbiAgICB0aGlzLnN1Z2dlc3Rpb25FbC5lbXB0eSgpO1xuICAgIHRoaXMudmlzaWJsZVJlc3VsdHMgPSByZXN1bHRzLm1hcCgocmVzdWx0KSA9PiByZXN1bHQuZmlsZSk7XG4gICAgZm9yIChjb25zdCByZXN1bHQgb2YgcmVzdWx0cykge1xuICAgICAgdGhpcy5jcmVhdGVTdWdnZXN0aW9uKHJlc3VsdC5maWxlLCBmYWxzZSwgcmVzdWx0LmV4Y2VycHQpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3VnZ2VzdGlvbihmaWxlOiBURmlsZSwgZGlyZWN0OiBib29sZWFuLCBleGNlcnB0Pzogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLnN1Z2dlc3Rpb25FbCkgcmV0dXJuO1xuICAgIGNvbnN0IGJ1dHRvbiA9IHRoaXMuc3VnZ2VzdGlvbkVsLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcInJhemJvci1zdWdnZXN0aW9uXCIgfSk7XG4gICAgY29uc3QgaWNvbiA9IGJ1dHRvbi5jcmVhdGVTcGFuKHsgY2xzOiBcInJhemJvci1zdWdnZXN0aW9uLWljb25cIiB9KTtcbiAgICBzZXRJY29uKGljb24sIGRpcmVjdCA/IFwiY29ybmVyLWRvd24tcmlnaHRcIiA6IFwiZmlsZS10ZXh0XCIpO1xuICAgIGNvbnN0IGxhYmVscyA9IGJ1dHRvbi5jcmVhdGVTcGFuKHsgY2xzOiBcInJhemJvci1zdWdnZXN0aW9uLWxhYmVsc1wiIH0pO1xuICAgIGxhYmVscy5jcmVhdGVTcGFuKHsgY2xzOiBcInJhemJvci1zdWdnZXN0aW9uLXRpdGxlXCIsIHRleHQ6IGZpbGUuYmFzZW5hbWUgfSk7XG4gICAgbGFiZWxzLmNyZWF0ZVNwYW4oeyBjbHM6IFwicmF6Ym9yLXN1Z2dlc3Rpb24tcGF0aFwiLCB0ZXh0OiBmaWxlLnBhcmVudD8ucGF0aCA9PT0gXCIvXCIgPyBcIlwiIDogZmlsZS5wYXJlbnQ/LnBhdGggPz8gXCJcIiB9KTtcbiAgICBpZiAoZXhjZXJwdCkgbGFiZWxzLmNyZWF0ZVNwYW4oeyBjbHM6IFwicmF6Ym9yLXN1Z2dlc3Rpb24tZXhjZXJwdFwiLCB0ZXh0OiBjbGVhbkV4Y2VycHQoZXhjZXJwdCkgfSk7XG4gICAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB2b2lkIHRoaXMuYXNzaWduKGZpbGUpKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0U2VhcmNoUmVzdWx0cyhxdWVyeTogc3RyaW5nKTogUHJvbWlzZTxBcnJheTx7IGZpbGU6IFRGaWxlOyBleGNlcnB0Pzogc3RyaW5nIH0+PiB7XG4gICAgY29uc3QgZmlsZXMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkuZmlsdGVyKChmaWxlKSA9PiBmaWxlLnBhdGggIT09IHRoaXMuc291cmNlUGF0aCk7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHF1ZXJ5LnRyaW0oKS50b0xvY2FsZUxvd2VyQ2FzZSgpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIGZpbGVzLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gYS5iYXNlbmFtZS5sb2NhbGVDb21wYXJlKGIuYmFzZW5hbWUsIFwicnVcIikpLnNsaWNlKDAsIDcpLm1hcCgoZmlsZSkgPT4gKHsgZmlsZSB9KSk7XG5cbiAgICBjb25zdCBvbW5pc2VhcmNoID0gdGhpcy5nZXRPbW5pc2VhcmNoKCk7XG4gICAgaWYgKG9tbmlzZWFyY2gpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBvbW5pc2VhcmNoLnNlYXJjaChxdWVyeS50cmltKCkpO1xuICAgICAgICBjb25zdCBtYXBwZWQgPSByZXN1bHRzLm1hcCgocmVzdWx0KSA9PiB7XG4gICAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChyZXN1bHQucGF0aCk7XG4gICAgICAgICAgcmV0dXJuIGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiICYmIGZpbGUucGF0aCAhPT0gdGhpcy5zb3VyY2VQYXRoXG4gICAgICAgICAgICA/IHsgZmlsZSwgZXhjZXJwdDogcmVzdWx0LmV4Y2VycHQgfVxuICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICB9KS5maWx0ZXIoKHJlc3VsdCk6IHJlc3VsdCBpcyB7IGZpbGU6IFRGaWxlOyBleGNlcnB0OiBzdHJpbmcgfCB1bmRlZmluZWQgfSA9PiByZXN1bHQgIT09IG51bGwpO1xuICAgICAgICBpZiAobWFwcGVkLmxlbmd0aCkgcmV0dXJuIG1hcHBlZC5zbGljZSgwLCA3KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJQYXJzaW5nOiBcdTA0M0VcdTA0NDhcdTA0MzhcdTA0MzFcdTA0M0FcdTA0MzAgT21uaXNlYXJjaCwgXHUwNDM4XHUwNDQxXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDRDXHUwNDM3XHUwNDQzXHUwNDM1XHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzMFx1MDQ0MVx1MDQzRFx1MDQzRVx1MDQzOSBcdTA0M0ZcdTA0M0VcdTA0MzhcdTA0NDFcdTA0M0FcIiwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWxlcy5tYXAoKGZpbGUpID0+ICh7IGZpbGUsIHNjb3JlOiBub3RlU2NvcmUoZmlsZSwgbm9ybWFsaXplZCkgfSkpXG4gICAgICAuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUgfHwgYS5maWxlLmJhc2VuYW1lLmxvY2FsZUNvbXBhcmUoYi5maWxlLmJhc2VuYW1lLCBcInJ1XCIpKVxuICAgICAgLnNsaWNlKDAsIDcpXG4gICAgICAubWFwKChlbnRyeSkgPT4gKHsgZmlsZTogZW50cnkuZmlsZSB9KSk7XG4gIH1cblxuICBwcml2YXRlIGdldE9tbmlzZWFyY2goKTogT21uaXNlYXJjaEFwaSB8IG51bGwge1xuICAgIGNvbnN0IGdsb2JhbEFwaSA9IChnbG9iYWxUaGlzIGFzIHR5cGVvZiBnbG9iYWxUaGlzICYgeyBvbW5pc2VhcmNoPzogT21uaXNlYXJjaEFwaSB9KS5vbW5pc2VhcmNoO1xuICAgIGlmIChnbG9iYWxBcGk/LnNlYXJjaCkgcmV0dXJuIGdsb2JhbEFwaTtcbiAgICBjb25zdCBwbHVnaW5zID0gKHRoaXMuYXBwIGFzIEFwcCAmIHsgcGx1Z2lucz86IHsgcGx1Z2lucz86IFJlY29yZDxzdHJpbmcsIHsgYXBpPzogT21uaXNlYXJjaEFwaTsgc2VhcmNoPzogT21uaXNlYXJjaEFwaVtcInNlYXJjaFwiXSB9PiB9IH0pLnBsdWdpbnM/LnBsdWdpbnM7XG4gICAgY29uc3QgcGx1Z2luID0gcGx1Z2lucz8ub21uaXNlYXJjaDtcbiAgICBpZiAocGx1Z2luPy5hcGk/LnNlYXJjaCkgcmV0dXJuIHBsdWdpbi5hcGk7XG4gICAgaWYgKHBsdWdpbj8uc2VhcmNoKSByZXR1cm4geyBzZWFyY2g6IHBsdWdpbi5zZWFyY2guYmluZChwbHVnaW4pIH07XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlbmRCeUVudGVyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLmxpbmVzW3RoaXMuaW5kZXhdO1xuICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xuICAgIGlmIChjdXJyZW50LmRpcmVjdFRhcmdldCAmJiAhdGhpcy5pbnB1dEVsPy52YWx1ZS50cmltKCkpIHtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoY3VycmVudC5kaXJlY3RUYXJnZXQpO1xuICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkgYXdhaXQgdGhpcy5hc3NpZ24oZmlsZSwgY3VycmVudC5kaXJlY3RUZXh0ID8/IFwiXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBsZXQgbWF0Y2ggPSB0aGlzLnZpc2libGVSZXN1bHRzWzBdO1xuICAgIGlmICghbWF0Y2gpIG1hdGNoID0gKGF3YWl0IHRoaXMuZ2V0U2VhcmNoUmVzdWx0cyh0aGlzLmlucHV0RWw/LnZhbHVlID8/IFwiXCIpKVswXT8uZmlsZTtcbiAgICBpZiAobWF0Y2gpIGF3YWl0IHRoaXMuYXNzaWduKG1hdGNoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXNzaWduKHRhcmdldDogVEZpbGUsIG92ZXJyaWRlVGV4dD86IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLmxpbmVzW3RoaXMuaW5kZXhdO1xuICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xuICAgIGNvbnN0IHRleHQgPSBvdmVycmlkZVRleHQgPz8gY3VycmVudC50ZXh0O1xuICAgIGlmICghdGV4dCkge1xuICAgICAgbmV3IE5vdGljZShcIlx1MDQxRlx1MDQzRVx1MDQ0MVx1MDQzQlx1MDQzNSBcdTA0M0RcdTA0MzBcdTA0MzdcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDM3XHUwNDMwXHUwNDNDXHUwNDM1XHUwNDQyXHUwNDNBXHUwNDM4IFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzQVx1MDQzMCBcdTA0M0ZcdTA0NDNcdTA0NDFcdTA0NDJcdTA0MzBcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCB0YXJnZXRDb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZCh0YXJnZXQpO1xuICAgICAgY29uc3QgZm9ybWF0dGVkVGV4dCA9IGZvcm1hdEZvclBlcnNwZWN0aXZpc20odGV4dCwgdGFyZ2V0Q29udGVudCk7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKHRhcmdldCwgKGNvbnRlbnQpID0+IGFwcGVuZExpbmUoY29udGVudCwgZm9ybWF0dGVkVGV4dCkpO1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVGcm9tU291cmNlKGN1cnJlbnQub3JpZ2luYWwpO1xuICAgICAgdGhpcy5yZW1vdmVDdXJyZW50RnJvbVF1ZXVlKCk7XG4gICAgICB0aGlzLnVwZGF0ZUN1cnJlbnRMaW5lKCk7XG4gICAgICB0aGlzLmlucHV0RWw/LmZvY3VzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJQYXJzaW5nOiBcdTA0M0VcdTA0NDhcdTA0MzhcdTA0MzFcdTA0M0FcdTA0MzAgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDM4XCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYFx1MDQxRFx1MDQzNSBcdTA0NDNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0M0VcdTA0NDFcdTA0NEMgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDQyXHUwNDRDIFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzQVx1MDQ0MyBcdTA0MzIgXHUwMEFCJHt0YXJnZXQuYmFzZW5hbWV9XHUwMEJCYCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW1vdmVGcm9tU291cmNlKG9yaWdpbmFsOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGhpcy5zb3VyY2VQYXRoKTtcbiAgICBpZiAoIShzb3VyY2UgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybjtcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKHNvdXJjZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGVvbCA9IGNvbnRlbnQuaW5jbHVkZXMoXCJcXHJcXG5cIikgPyBcIlxcclxcblwiIDogXCJcXG5cIjtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgaW5kZXggPSBsaW5lcy5pbmRleE9mKG9yaWdpbmFsKTtcbiAgICAgIGlmIChpbmRleCA+PSAwKSBsaW5lcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oZW9sKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVtb3ZlQ3VycmVudEZyb21RdWV1ZSgpOiB2b2lkIHtcbiAgICB0aGlzLmxpbmVzLnNwbGljZSh0aGlzLmluZGV4LCAxKTtcbiAgICBpZiAodGhpcy5pbmRleCA+PSB0aGlzLmxpbmVzLmxlbmd0aCAmJiB0aGlzLmxpbmVzLmxlbmd0aCA+IDApIHRoaXMuaW5kZXggPSB0aGlzLmxpbmVzLmxlbmd0aCAtIDE7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGRlbGV0ZUN1cnJlbnRMaW5lKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLmxpbmVzW3RoaXMuaW5kZXhdO1xuICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbW92ZUZyb21Tb3VyY2UoY3VycmVudC5vcmlnaW5hbCk7XG4gICAgICB0aGlzLmxpbmVzLnNwbGljZSh0aGlzLmluZGV4LCAxKTtcbiAgICAgIGlmICh0aGlzLmluZGV4ID49IHRoaXMubGluZXMubGVuZ3RoICYmIHRoaXMubGluZXMubGVuZ3RoID4gMCkgdGhpcy5pbmRleCA9IHRoaXMubGluZXMubGVuZ3RoIC0gMTtcbiAgICAgIHRoaXMudXBkYXRlQ3VycmVudExpbmUoKTtcbiAgICAgIHRoaXMuaW5wdXRFbD8uZm9jdXMoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIlBhcnNpbmc6IFx1MDQzRVx1MDQ0OFx1MDQzOFx1MDQzMVx1MDQzQVx1MDQzMCBcdTA0NDNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDQxXHUwNDQyXHUwNDQwXHUwNDNFXHUwNDNBXHUwNDM4XCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoXCJcdTA0MURcdTA0MzUgXHUwNDQzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDNFXHUwNDQxXHUwNDRDIFx1MDQ0M1x1MDQzNFx1MDQzMFx1MDQzQlx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0M0VcdTA0M0FcdTA0NDMgXHUwNDM4XHUwNDM3IFx1MDQzOFx1MDQ0MVx1MDQ0NVx1MDQzRVx1MDQzNFx1MDQzRFx1MDQzRVx1MDQzOSBcdTA0MzdcdTA0MzBcdTA0M0NcdTA0MzVcdTA0NDJcdTA0M0FcdTA0MzhcIik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBvbktleURvd24oZXZlbnQ6IEtleWJvYXJkRXZlbnQpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuaXNBY3RpdmVWaWV3KCkpIHJldHVybjtcbiAgICBpZiAoZXZlbnQudGFyZ2V0ID09PSB0aGlzLmNyZWF0ZU5vdGVJbnB1dEVsKSByZXR1cm47XG4gICAgY29uc3QgdGFyZ2V0ID0gZXZlbnQudGFyZ2V0O1xuICAgIGNvbnN0IGlzVGV4dFRhcmdldCA9IHRhcmdldCBpbnN0YW5jZW9mIEhUTUxJbnB1dEVsZW1lbnQgfHxcbiAgICAgIHRhcmdldCBpbnN0YW5jZW9mIEhUTUxUZXh0QXJlYUVsZW1lbnQgfHxcbiAgICAgIHRhcmdldCBpbnN0YW5jZW9mIEhUTUxFbGVtZW50ICYmIHRhcmdldC5pc0NvbnRlbnRFZGl0YWJsZTtcbiAgICBpZiAoIWlzVGV4dFRhcmdldCAmJiAhZXZlbnQuY3RybEtleSAmJiAhZXZlbnQuYWx0S2V5ICYmICFldmVudC5tZXRhS2V5ICYmIGV2ZW50LmtleS5sZW5ndGggPT09IDEpIHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICB0aGlzLmlucHV0RWw/LmZvY3VzKCk7XG4gICAgICBpZiAodGhpcy5pbnB1dEVsKSB7XG4gICAgICAgIHRoaXMuaW5wdXRFbC52YWx1ZSArPSBldmVudC5rZXk7XG4gICAgICAgIHRoaXMuaW5wdXRFbC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudChcImlucHV0XCIsIHsgYnViYmxlczogdHJ1ZSB9KSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghZXZlbnQuY3RybEtleSAmJiAhZXZlbnQuYWx0S2V5ICYmICFldmVudC5tZXRhS2V5ICYmICFldmVudC5zaGlmdEtleSAmJlxuICAgICAgKGV2ZW50LmtleSA9PT0gXCJBcnJvd0xlZnRcIiB8fCBldmVudC5rZXkgPT09IFwiQXJyb3dSaWdodFwiKSkge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5uYXZpZ2F0ZShldmVudC5rZXkgPT09IFwiQXJyb3dMZWZ0XCIgPyAtMSA6IDEpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoZXZlbnQuY3RybEtleSAmJiBldmVudC5zaGlmdEtleSAmJiAhZXZlbnQuYWx0S2V5ICYmICFldmVudC5tZXRhS2V5ICYmXG4gICAgICAoZXZlbnQuY29kZSA9PT0gXCJLZXlIXCIgfHwgZXZlbnQuY29kZSA9PT0gXCJLZXlMXCIpKSB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm5hdmlnYXRlKGV2ZW50LmNvZGUgPT09IFwiS2V5SFwiID8gLTEgOiAxKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGV2ZW50LmN0cmxLZXkgJiYgZXZlbnQuc2hpZnRLZXkgJiYgIWV2ZW50LmFsdEtleSAmJiAhZXZlbnQubWV0YUtleSAmJiBldmVudC5rZXkgPT09IFwiQmFja3NwYWNlXCIpIHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHZvaWQgdGhpcy5kZWxldGVDdXJyZW50TGluZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoZXZlbnQuY3RybEtleSAmJiBldmVudC5zaGlmdEtleSAmJiAhZXZlbnQuYWx0S2V5ICYmICFldmVudC5tZXRhS2V5ICYmIGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5DcmVhdGVOb3RlSW5wdXQoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFldmVudC5jdHJsS2V5IHx8ICFldmVudC5zaGlmdEtleSB8fCBldmVudC5hbHRLZXkgfHwgZXZlbnQubWV0YUtleSkgcmV0dXJuO1xuICAgIGNvbnN0IGluZGV4ID0gU0hPUlRDVVRfQ09ERVMuaW5kZXhPZihldmVudC5jb2RlIGFzIHR5cGVvZiBTSE9SVENVVF9DT0RFU1tudW1iZXJdKTtcbiAgICBpZiAoaW5kZXggPCAwKSByZXR1cm47XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuc2lkZU5vdGVzW2luZGV4XTtcbiAgICBpZiAoIWZpbGUpIHJldHVybjtcbiAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIHZvaWQgdGhpcy5hc3NpZ24oZmlsZSk7XG4gIH1cblxuICBwcml2YXRlIGlzQWN0aXZlVmlldygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoUmF6Ym9yVmlldykgPT09IHRoaXM7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckVycm9yKG1lc3NhZ2U6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5jb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInJhemJvci1lcnJvclwiLCB0ZXh0OiBtZXNzYWdlIH0pO1xuICB9XG59XG5cbmNsYXNzIFJhemJvclNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHByaXZhdGUgcGx1Z2luOiBSYXpib3JQbHVnaW4pIHsgc3VwZXIoYXBwLCBwbHVnaW4pOyB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiUGFyc2luZ1wiIH0pO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB0ZXh0OiBcIlx1MDQxN1x1MDQzMFx1MDQzQVx1MDQ0MFx1MDQzNVx1MDQzRlx1MDQzQlx1MDQ1MVx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0MzdcdTA0MzBcdTA0M0NcdTA0MzVcdTA0NDJcdTA0M0FcdTA0MzggXHUwNDM3XHUwNDMwXHUwNDNEXHUwNDM4XHUwNDNDXHUwNDMwXHUwNDRFXHUwNDQyIFx1MDQzMVx1MDQzRVx1MDQzQVx1MDQzRVx1MDQzMlx1MDQ0Qlx1MDQzNSBcdTA0M0FcdTA0M0RcdTA0M0VcdTA0M0ZcdTA0M0FcdTA0MzggXHUwNDQwXHUwNDMwXHUwNDNEXHUwNDRDXHUwNDQ4XHUwNDM1IFx1MDQzN1x1MDQzMFx1MDQzQ1x1MDQzNVx1MDQ0Mlx1MDQzRVx1MDQzQSBcdTA0MzhcdTA0MzcgQWN0aXZpdHkuIFx1MDQxQ1x1MDQzRVx1MDQzNlx1MDQzRFx1MDQzRSBcdTA0NDNcdTA0M0FcdTA0MzBcdTA0MzdcdTA0MzBcdTA0NDJcdTA0NEMgXHUwNDNEXHUwNDMwXHUwNDM3XHUwNDMyXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1IFx1MDQzOFx1MDQzQlx1MDQzOCBcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0M0RcdTA0NEJcdTA0MzkgXHUwNDNGXHUwNDQzXHUwNDQyXHUwNDRDLlwiXG4gICAgfSk7XG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IDY7IGluZGV4KyspIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShgXHUwNDE3XHUwNDMwXHUwNDNBXHUwNDQwXHUwNDM1XHUwNDNGXHUwNDNCXHUwNDUxXHUwNDNEXHUwNDNEXHUwNDMwXHUwNDRGIFx1MDQzN1x1MDQzMFx1MDQzQ1x1MDQzNVx1MDQ0Mlx1MDQzQVx1MDQzMCAke2luZGV4ICsgMX1gKVxuICAgICAgICAuc2V0RGVzYyhgQ3RybCtTaGlmdCske1NIT1JUQ1VUU1tpbmRleF19YClcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJcdTA0MURcdTA0MzBcdTA0MzdcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzhcdTA0MzUgXHUwNDM4XHUwNDNCXHUwNDM4IFx1MDQzRlx1MDQ0M1x1MDQ0Mlx1MDQ0Q1wiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5waW5uZWROb3Rlc1tpbmRleF0gPz8gXCJcIilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5waW5uZWROb3Rlc1tpbmRleF0gPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSk7XG4gICAgfVxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTA0MThcdTA0MzRcdTA0MzVcdTA0M0RcdTA0NDJcdTA0MzhcdTA0NDRcdTA0MzhcdTA0M0FcdTA0MzBcdTA0NDJcdTA0M0VcdTA0NDAgXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDMzXHUwNDM4XHUwNDNEXHUwNDMwIEFjdGl2aXR5XCIpXG4gICAgICAuc2V0RGVzYyhcIlx1MDQxRlx1MDQzRSBcdTA0NDNcdTA0M0NcdTA0M0VcdTA0M0JcdTA0NDdcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NEU6IGFjdGl2aXR5XCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT4gdGV4dFxuICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYWN0aXZpdHlQbHVnaW5JZClcbiAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmFjdGl2aXR5UGx1Z2luSWQgPSB2YWx1ZS50cmltKCkgfHwgXCJhY3Rpdml0eVwiO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwZW5kTGluZShjb250ZW50OiBzdHJpbmcsIHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVvbCA9IGNvbnRlbnQuaW5jbHVkZXMoXCJcXHJcXG5cIikgPyBcIlxcclxcblwiIDogXCJcXG5cIjtcbiAgaWYgKCFjb250ZW50Lmxlbmd0aCkgcmV0dXJuIHRleHQ7XG4gIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBzZXJ2aWNlSW5kZXggPSBsaW5lcy5maW5kSW5kZXgoKGxpbmUpID0+IGxpbmUudHJpbSgpLnRvTG9jYWxlTG93ZXJDYXNlKCkgPT09IFwicHBwXCIpO1xuICBpZiAoc2VydmljZUluZGV4ID49IDApIHtcbiAgICBsaW5lcy5zcGxpY2Uoc2VydmljZUluZGV4LCAwLCB0ZXh0KTtcbiAgICByZXR1cm4gbGluZXMuam9pbihlb2wpO1xuICB9XG4gIHJldHVybiBgJHtjb250ZW50LnJlcGxhY2UoLyg/Olxccj9cXG4pKiQvLCBcIlwiKX0ke2VvbH0ke3RleHR9JHtlb2x9YDtcbn1cblxuZnVuY3Rpb24gZm9ybWF0Rm9yUGVyc3BlY3RpdmlzbSh0ZXh0OiBzdHJpbmcsIHRhcmdldENvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRlbXBsYXRlID0gZmluZFBlcnNwZWN0aXZpc21UZW1wbGF0ZSh0YXJnZXRDb250ZW50KTtcbiAgcmV0dXJuIHRlbXBsYXRlPy5pbmNsdWRlcyhcInBcIikgPyB0ZW1wbGF0ZS5zcGxpdChcInBcIikuam9pbih0ZXh0KSA6IHRleHQ7XG59XG5cbmZ1bmN0aW9uIGZpbmRQZXJzcGVjdGl2aXNtVGVtcGxhdGUoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGxpbmVzID0gY29udGVudC5yZXBsYWNlKC9cXHJcXG4vZywgXCJcXG5cIikucmVwbGFjZSgvXFxyL2csIFwiXFxuXCIpLnNwbGl0KFwiXFxuXCIpO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgaWYgKGxpbmVzW2luZGV4XS50cmltKCkudG9Mb2NhbGVMb3dlckNhc2UoKSA9PT0gXCJwcHBcIikgcmV0dXJuIGxpbmVzW2luZGV4ICsgMV0gPz8gXCJcIjtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gY2xlYW5FeGNlcnB0KGV4Y2VycHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBleGNlcnB0XG4gICAgLnJlcGxhY2UoLzxbXj5dKz4vZywgXCJcIilcbiAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBub3RlU2NvcmUoZmlsZTogVEZpbGUsIHF1ZXJ5OiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCB0aXRsZSA9IGZpbGUuYmFzZW5hbWUudG9Mb2NhbGVMb3dlckNhc2UoKTtcbiAgY29uc3QgcGF0aCA9IGZpbGUucGF0aC50b0xvY2FsZUxvd2VyQ2FzZSgpO1xuICBpZiAodGl0bGUgPT09IHF1ZXJ5KSByZXR1cm4gMTAwMDAwO1xuICBsZXQgc2NvcmUgPSAwO1xuICBpZiAodGl0bGUuc3RhcnRzV2l0aChxdWVyeSkpIHNjb3JlICs9IDMwMDA7XG4gIGlmICh0aXRsZS5pbmNsdWRlcyhxdWVyeSkpIHNjb3JlICs9IDE4MDAgLSB0aXRsZS5pbmRleE9mKHF1ZXJ5KSAqIDU7XG4gIGlmIChwYXRoLmluY2x1ZGVzKHF1ZXJ5KSkgc2NvcmUgKz0gNDAwO1xuICBzY29yZSArPSBzdWJzZXF1ZW5jZVNjb3JlKHRpdGxlLCBxdWVyeSk7XG4gIHNjb3JlIC09IGxldmVuc2h0ZWluKHRpdGxlLCBxdWVyeSkgKiA4O1xuICByZXR1cm4gc2NvcmU7XG59XG5cbmZ1bmN0aW9uIHN1YnNlcXVlbmNlU2NvcmUodGV4dDogc3RyaW5nLCBxdWVyeTogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IHF1ZXJ5SW5kZXggPSAwO1xuICBsZXQgc3RyZWFrID0gMDtcbiAgbGV0IHNjb3JlID0gMDtcbiAgZm9yIChjb25zdCBjaGFyYWN0ZXIgb2YgdGV4dCkge1xuICAgIGlmIChjaGFyYWN0ZXIgPT09IHF1ZXJ5W3F1ZXJ5SW5kZXhdKSB7XG4gICAgICBxdWVyeUluZGV4ICs9IDE7XG4gICAgICBzdHJlYWsgKz0gMTtcbiAgICAgIHNjb3JlICs9IDIwICsgc3RyZWFrICogODtcbiAgICAgIGlmIChxdWVyeUluZGV4ID09PSBxdWVyeS5sZW5ndGgpIHJldHVybiBzY29yZTtcbiAgICB9IGVsc2Ugc3RyZWFrID0gMDtcbiAgfVxuICByZXR1cm4gcXVlcnlJbmRleCA9PT0gcXVlcnkubGVuZ3RoID8gc2NvcmUgOiAtMTAwMDtcbn1cblxuZnVuY3Rpb24gbGV2ZW5zaHRlaW4obGVmdDogc3RyaW5nLCByaWdodDogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3QgcHJldmlvdXMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiByaWdodC5sZW5ndGggKyAxIH0sIChfLCBpbmRleCkgPT4gaW5kZXgpO1xuICBmb3IgKGxldCBpID0gMTsgaSA8PSBsZWZ0Lmxlbmd0aDsgaSsrKSB7XG4gICAgbGV0IGRpYWdvbmFsID0gcHJldmlvdXNbMF07XG4gICAgcHJldmlvdXNbMF0gPSBpO1xuICAgIGZvciAobGV0IGogPSAxOyBqIDw9IHJpZ2h0Lmxlbmd0aDsgaisrKSB7XG4gICAgICBjb25zdCBzYXZlZCA9IHByZXZpb3VzW2pdO1xuICAgICAgcHJldmlvdXNbal0gPSBNYXRoLm1pbihwcmV2aW91c1tqXSArIDEsIHByZXZpb3VzW2ogLSAxXSArIDEsIGRpYWdvbmFsICsgKGxlZnRbaSAtIDFdID09PSByaWdodFtqIC0gMV0gPyAwIDogMSkpO1xuICAgICAgZGlhZ29uYWwgPSBzYXZlZDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHByZXZpb3VzW3JpZ2h0Lmxlbmd0aF07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUFjdGl2aXR5RW50cmllcyhyYXc6IHVua25vd24pOiBBY3Rpdml0eUVudHJ5W10ge1xuICBjb25zdCBzb3VyY2U6IHVua25vd25bXSA9IEFycmF5LmlzQXJyYXkocmF3KVxuICAgID8gcmF3XG4gICAgOiByYXcgJiYgdHlwZW9mIHJhdyA9PT0gXCJvYmplY3RcIlxuICAgICAgPyBPYmplY3QuZW50cmllcyhyYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLm1hcCgoW3BhdGgsIHZhbHVlXSkgPT5cbiAgICAgICAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgPyB7IHBhdGgsIC4uLih2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgfSA6IHsgcGF0aCwgb3BlbkNvdW50OiB2YWx1ZSB9KVxuICAgICAgOiBbXTtcbiAgcmV0dXJuIHNvdXJjZS5tYXAoKGl0ZW0pOiBBY3Rpdml0eUVudHJ5IHwgbnVsbCA9PiB7XG4gICAgaWYgKHR5cGVvZiBpdGVtID09PSBcInN0cmluZ1wiKSByZXR1cm4geyBwYXRoOiBpdGVtLCBvcGVuQ291bnQ6IDAgfTtcbiAgICBpZiAoIWl0ZW0gfHwgdHlwZW9mIGl0ZW0gIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHJvdyA9IGl0ZW0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgY29uc3QgcGF0aCA9IHJvdy5wYXRoID8/IHJvdy5maWxlUGF0aCA/PyByb3cubm90ZVBhdGg7XG4gICAgY29uc3QgY291bnQgPSByb3cub3BlbkNvdW50ID8/IHJvdy5vcGVucyA/PyByb3cub3BlbmluZ3MgPz8gcm93LmNvdW50ID8/IDA7XG4gICAgcmV0dXJuIHR5cGVvZiBwYXRoID09PSBcInN0cmluZ1wiID8geyBwYXRoLCBvcGVuQ291bnQ6IE51bWJlcihjb3VudCkgfHwgMCB9IDogbnVsbDtcbiAgfSkuZmlsdGVyKChlbnRyeSk6IGVudHJ5IGlzIEFjdGl2aXR5RW50cnkgPT4gZW50cnkgIT09IG51bGwpXG4gICAgLnNvcnQoKGEsIGIpID0+IGIub3BlbkNvdW50IC0gYS5vcGVuQ291bnQpO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxzQkFhTztBQUVQLElBQU0sWUFBWTtBQUNsQixJQUFNLFlBQVksQ0FBQyxLQUFLLEtBQUssS0FBSyxLQUFLLEtB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
