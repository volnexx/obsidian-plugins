const { MarkdownView, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
const { Decoration, EditorView, ViewPlugin } = require("@codemirror/view");

const BODY_CLASS = "focus-zen-black-active";
const TARGET_VIEW_CLASS = "focus-zen-black-target-view";
const TARGET_LEAF_CLASS = "focus-zen-black-target-leaf";
const TARGET_TABS_CLASS = "focus-zen-black-target-tabs";
const CURRENT_LINE_CLASS = "focus-zen-black-current-line";
const ROLE_DROPDOWN_SELECTOR = ".rsp-role-dropdown";

const DEFAULT_SETTINGS = {
  mutedLineOpacityPercent: 28,
};

const activeLineDecoration = Decoration.line({ class: CURRENT_LINE_CLASS });

function isZenActive() {
  return document.body.classList.contains(BODY_CLASS);
}

function buildActiveLineDecorations(view) {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return Decoration.set([activeLineDecoration.range(line.from)], true);
}

function centerActiveLine(view) {
  if (!view || !isZenActive()) return;

  try {
    const head = view.state.selection.main.head;
    view.dispatch({
      effects: EditorView.scrollIntoView(head, {
        x: "nearest",
        y: "center",
        yMargin: 0,
      }),
    });
  } catch (error) {
    console.warn("zen-mode: unable to center the active line", error);
  }
}

function scheduleCenterActiveLine(view, pendingFrames) {
  if (!view || !isZenActive()) return;

  const pendingFrame = pendingFrames.get(view);
  if (pendingFrame) window.cancelAnimationFrame(pendingFrame);

  const frame = window.requestAnimationFrame(() => {
    pendingFrames.delete(view);
    centerActiveLine(view);
  });
  pendingFrames.set(view, frame);
}

function makeActiveLinePlugin(pendingFrames) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = buildActiveLineDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildActiveLineDecorations(update.view);
      }

      if (isZenActive() && (update.selectionSet || update.focusChanged)) {
        scheduleCenterActiveLine(update.view, pendingFrames);
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  });
}

module.exports = class FocusZenModePlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
    };
    this.settings.mutedLineOpacityPercent = normalizeOpacityPercent(
      this.settings.mutedLineOpacityPercent
    );

    this.isActive = false;
    this.targetViewEl = null;
    this.targetLeafEl = null;
    this.targetTabsEl = null;
    this.pendingCenterFrames = new WeakMap();

    document.body.classList.remove(BODY_CLASS);
    this.applyMutedOpacity();

    this.ribbonIconEl = this.addRibbonIcon("focus", "Focus Zen Black", () => {
      this.toggleZenMode();
    });
    this.ribbonIconEl?.classList.add("focus-zen-black-ribbon-button");

    this.addCommand({
      id: "toggle-zen-mode",
      name: "Toggle zen mode",
      callback: () => this.toggleZenMode(),
    });

    this.addCommand({
      id: "enter-zen-mode",
      name: "Enter zen mode",
      callback: () => this.enableZenMode(),
    });

    this.addCommand({
      id: "exit-zen-mode",
      name: "Exit zen mode",
      callback: () => this.disableZenMode(),
    });

    this.registerEditorExtension([makeActiveLinePlugin(this.pendingCenterFrames)]);

    this.addSettingTab(new ZenModeSettingTab(this.app, this));

    this.registerDomEvent(document, "keydown", (event) => {
      this.handleKeydown(event);
    }, { capture: true });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      if (!this.isActive) return;

      const view = this.getEditableMarkdownView();
      if (!view) return;

      this.setTargetView(view);
      this.focusAndCenterSoon();
    }));

    this.registerEvent(this.app.workspace.on("layout-change", () => {
      if (this.isActive) this.focusAndCenterSoon();
    }));

    this.register(() => {
      this.disableZenMode();
    });
  }

  onunload() {
    this.disableZenMode();
    document.getElementById("focus-zen-black-custom-settings")?.remove();
  }

  toggleZenMode() {
    if (this.isActive) {
      this.disableZenMode();
      return;
    }

    this.enableZenMode();
  }

  enableZenMode() {
    const view = this.getEditableMarkdownView();
    if (!view) {
      new Notice("Open a Markdown note in editing mode before entering Zen mode.");
      return false;
    }

    this.isActive = true;
    document.body.classList.add(BODY_CLASS);
    this.ribbonIconEl?.classList.add("is-active");
    this.setTargetView(view);
    this.focusAndCenterSoon();
    return true;
  }

  disableZenMode() {
    this.isActive = false;
    document.body.classList.remove(BODY_CLASS);
    this.ribbonIconEl?.classList.remove("is-active");
    this.clearTargetView();
  }

  handleKeydown(event) {
    if (!this.isActive) return;
    if (event.key !== "Escape") return;

    // red-screen-play uses Escape to close its Shift-triggered role picker.
    // Leave that flow alone so role insertion keeps working inside Zen mode.
    if (document.querySelector(ROLE_DROPDOWN_SELECTOR)) return;
    if (event.defaultPrevented) return;

    event.preventDefault();
    event.stopPropagation();
    this.disableZenMode();
  }

  getEditableMarkdownView() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) return null;
    if (typeof view.getMode === "function" && view.getMode() !== "source") return null;
    return view;
  }

  setTargetView(view) {
    this.clearTargetView();

    const viewEl = view.containerEl ?? view.contentEl;
    const leafEl = viewEl?.closest?.(".workspace-leaf");
    const tabsEl = viewEl?.closest?.(".workspace-tabs");

    viewEl?.classList.add(TARGET_VIEW_CLASS);
    leafEl?.classList.add(TARGET_LEAF_CLASS);
    tabsEl?.classList.add(TARGET_TABS_CLASS);

    this.targetViewEl = viewEl ?? null;
    this.targetLeafEl = leafEl ?? null;
    this.targetTabsEl = tabsEl ?? null;
  }

  clearTargetView() {
    this.targetViewEl?.classList.remove(TARGET_VIEW_CLASS);
    this.targetLeafEl?.classList.remove(TARGET_LEAF_CLASS);
    this.targetTabsEl?.classList.remove(TARGET_TABS_CLASS);
    this.targetViewEl = null;
    this.targetLeafEl = null;
    this.targetTabsEl = null;
  }

  focusAndCenterSoon() {
    const view = this.getEditableMarkdownView();
    if (!view?.editor) return;

    view.editor.focus?.();

    const cm = view.editor.cm;
    if (!cm) return;

    cm.focus?.();
    scheduleCenterActiveLine(cm, this.pendingCenterFrames);
    window.setTimeout(() => scheduleCenterActiveLine(cm, this.pendingCenterFrames), 40);
    window.setTimeout(() => scheduleCenterActiveLine(cm, this.pendingCenterFrames), 140);
  }

  applyMutedOpacity() {
    const mutedOpacity = this.settings.mutedLineOpacityPercent / 100;
    const css = `
body.focus-zen-black-active {
  --focus-zen-black-muted-line-opacity: ${mutedOpacity};
}`;
    let el = document.getElementById("focus-zen-black-custom-settings");
    if (!el) {
      el = document.createElement("style");
      el.id = "focus-zen-black-custom-settings";
      document.head.appendChild(el);
    }
    el.textContent = css;
  }
};

const OPACITY_MIN = 0;
const OPACITY_MAX = 100;

function normalizeOpacityPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.mutedLineOpacityPercent;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(number)));
}

class ZenModeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    this.addHotkeySetting(containerEl);
    this.addMutedOpacitySetting(containerEl);
  }

  addHotkeySetting(containerEl) {
    new Setting(containerEl)
      .setName("Keyboard shortcut")
      .setDesc("Open Obsidian hotkey settings and assign a shortcut to “Focus Zen Black: Toggle zen mode”.")
      .addButton((button) => {
        button
          .setButtonText("Open hotkeys")
          .onClick(() => {
            const settingManager = this.app.setting;
            if (!settingManager?.openTabById) {
              new Notice("Open Settings → Hotkeys and search for Focus Zen Black.");
              return;
            }

            settingManager.open();
            settingManager.openTabById("hotkeys");
          });
      });
  }

  addMutedOpacitySetting(containerEl) {
    let valueEl;
    const setting = new Setting(containerEl)
      .setName("Unfocused text opacity")
      .setDesc("Opacity percentage for non-focused text lines.")
      .addSlider((slider) => {
        slider
          .setLimits(OPACITY_MIN, OPACITY_MAX, 1)
          .setValue(this.plugin.settings.mutedLineOpacityPercent)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.mutedLineOpacityPercent = normalizeOpacityPercent(value);
            if (valueEl) valueEl.setText(`${this.plugin.settings.mutedLineOpacityPercent}%`);
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyMutedOpacity();
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Reset")
          .onClick(async () => {
            this.plugin.settings.mutedLineOpacityPercent = DEFAULT_SETTINGS.mutedLineOpacityPercent;
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyMutedOpacity();
            this.display();
          });
      });

    valueEl = setting.controlEl.createSpan({
      cls: "focus-zen-black-opacity-value",
      text: `${this.plugin.settings.mutedLineOpacityPercent}%`,
    });
  }
}
