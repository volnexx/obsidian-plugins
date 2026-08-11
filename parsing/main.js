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
  deleteFromSource: false,
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
    const positions = separators.map((separator) => ({ separator, position: text.indexOf(separator) })).filter(({ position }) => position > 0).sort((a, b) => a.position - b.position);
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
    this.previousButton = this.createNavigationButton(lineStage, "left", "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430", "Ctrl+Shift+H", () => this.navigate(-1));
    const lineColumn = lineStage.createDiv({ cls: "razbor-line-column" });
    this.createNoteRowEl = lineColumn.createDiv({ cls: "razbor-create-note-row" });
    this.lineEl = lineColumn.createDiv({ cls: "razbor-line-card" });
    this.nextButton = this.createNavigationButton(lineStage, "right", "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430", "Ctrl+Shift+L", () => this.navigate(1));
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
      if (this.plugin.settings.deleteFromSource) await this.removeFromSource(current.original);
      this.closeCreateNoteInput(false);
      this.index += 1;
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
      if (this.plugin.settings.deleteFromSource) await this.removeFromSource(current.original);
      this.index += 1;
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
    new import_obsidian.Setting(containerEl).setName("\u0423\u0434\u0430\u043B\u044F\u0442\u044C \u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0451\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u043E\u043A\u0438 \u0438\u0437 \u0438\u0441\u0445\u043E\u0434\u043D\u043E\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438").setDesc("\u0412\u043A\u043B\u044E\u0447\u0430\u0435\u0442 \u043D\u0430\u0441\u0442\u043E\u044F\u0449\u0438\u0439 \u043F\u0435\u0440\u0435\u043D\u043E\u0441. \u0412 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u043E\u043C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0438 \u0441\u0442\u0440\u043E\u043A\u0438 \u043A\u043E\u043F\u0438\u0440\u0443\u044E\u0442\u0441\u044F.").addToggle((toggle) => toggle.setValue(this.plugin.settings.deleteFromSource).onChange(async (value) => {
      this.plugin.settings.deleteFromSource = value;
      await this.plugin.saveSettings();
    }));
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
