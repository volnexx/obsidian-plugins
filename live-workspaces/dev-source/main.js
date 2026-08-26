"use strict";
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
  default: () => LiveWorkspacesPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/commands/registerWorkspaceCommands.ts
var import_obsidian2 = require("obsidian");

// src/ui/WorkspaceModals.ts
var import_obsidian = require("obsidian");
var WorkspaceNameModal = class extends import_obsidian.Modal {
  constructor(app, title, initialValue, submit) {
    super(app);
    this.submit = submit;
    this.setTitle(title);
    this.value = initialValue;
  }
  value;
  onOpen() {
    this.contentEl.empty();
    new import_obsidian.Setting(this.contentEl).setName("Name").addText((text) => {
      text.setValue(this.value);
      text.inputEl.addEventListener("input", () => this.value = text.getValue());
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.finish();
      });
      window.setTimeout(() => {
        text.inputEl.focus();
        text.inputEl.select();
      });
    });
    new import_obsidian.Setting(this.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close())).addButton((button) => button.setCta().setButtonText("Save").onClick(() => this.finish()));
  }
  finish() {
    const value = this.value.trim();
    if (!value) return;
    this.submit(value);
    this.close();
  }
};
var DeleteWorkspaceModal = class extends import_obsidian.Modal {
  constructor(app, workspace, confirmDelete) {
    super(app);
    this.workspace = workspace;
    this.confirmDelete = confirmDelete;
    this.setTitle("Delete live workspace");
  }
  onOpen() {
    this.contentEl.empty();
    const paragraph = document.createElement("p");
    paragraph.textContent = `Delete \u201C${this.workspace.name}\u201D? Its live panes will be closed. This cannot be undone.`;
    this.contentEl.appendChild(paragraph);
    new import_obsidian.Setting(this.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close())).addButton(
      (button) => button.setWarning().setButtonText("Delete").onClick(() => {
        this.confirmDelete();
        this.close();
      })
    );
  }
};
var WorkspaceQuickSwitcher = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, items, choose) {
    super(app);
    this.items = items;
    this.choose = choose;
    this.setPlaceholder("Switch live workspace\u2026");
  }
  getItems() {
    return this.items().slice().sort((a, b) => a.order - b.order);
  }
  getItemText(item) {
    return item.hotkeySlot ? `${item.name}  \xB7  Slot ${item.hotkeySlot}` : item.name;
  }
  onChooseItem(item) {
    this.choose(item);
  }
};

// src/commands/registerWorkspaceCommands.ts
function registerWorkspaceCommands(plugin, manager) {
  const run = (operation) => {
    void operation.catch((error) => console.error("[Live Workspaces] Command failed", error));
  };
  plugin.addCommand({
    id: "create-workspace",
    name: "Workspace: Create",
    callback: () => new WorkspaceNameModal(plugin.app, "Create live workspace", manager.suggestWorkspaceName(), (name) => {
      run(manager.createWorkspace(name));
    }).open()
  });
  plugin.addCommand({
    id: "rename-workspace",
    name: "Workspace: Rename active",
    callback: () => {
      const active = manager.getActiveWorkspace();
      new WorkspaceNameModal(plugin.app, "Rename live workspace", active.name, (name) => manager.renameWorkspace(active.id, name)).open();
    }
  });
  plugin.addCommand({
    id: "delete-workspace",
    name: "Workspace: Delete active",
    checkCallback: (checking) => {
      if (manager.getWorkspaces().length <= 1) return false;
      if (!checking) {
        const active = manager.getActiveWorkspace();
        new DeleteWorkspaceModal(plugin.app, active, () => void manager.deleteWorkspace(active.id)).open();
      }
      return true;
    }
  });
  plugin.addCommand({ id: "next-workspace", name: "Workspace: Next", callback: () => run(manager.switchNext()) });
  plugin.addCommand({ id: "previous-workspace", name: "Workspace: Previous", callback: () => run(manager.switchPrevious()) });
  plugin.addCommand({
    id: "quick-switcher",
    name: "Workspace: Quick switcher",
    callback: () => new WorkspaceQuickSwitcher(plugin.app, () => manager.getWorkspaces(), (item) => run(manager.switchTo(item.id))).open()
  });
  for (let slot = 1; slot <= 9; slot += 1) {
    plugin.addCommand({
      id: `switch-to-slot-${slot}`,
      name: `Workspace: Switch to slot ${slot}`,
      checkCallback: (checking) => {
        const workspace = manager.getWorkspaceBySlot(slot);
        if (!workspace) return false;
        if (!checking) run(manager.switchTo(workspace.id));
        return true;
      }
    });
  }
  plugin.addCommand({
    id: "run-lifecycle-probe",
    name: "Workspace: Run lifecycle feasibility probe",
    checkCallback: (checking) => {
      if (manager.getWorkspaces().length < 2) return false;
      if (!checking) {
        void manager.runLifecycleProbe().then((result) => {
          console.info("[Live Workspaces] Lifecycle probe", result);
          new import_obsidian2.Notice(result.passed ? "Live Workspaces probe passed. See developer console for details." : "Live Workspaces probe failed; fail-safe enabled. See developer console.", 8e3);
        });
      }
      return true;
    }
  });
  plugin.addCommand({
    id: "fail-safe-show-all",
    name: "Workspace: Fail-safe \u2014 show all panes",
    callback: () => manager.showAllPanes()
  });
}

// src/workspace/WorkspaceManager.ts
var import_obsidian3 = require("obsidian");

// src/utils/leaf.ts
function getLeafId(leaf) {
  return leaf.id ?? "";
}
function getTabsElement(leaf) {
  return leaf.view.containerEl.closest(".workspace-tabs");
}
function getTabsParent(leaf) {
  const parent = leaf.parent;
  return getTabsElement(leaf) ? parent : null;
}
function areaForLeaf(leaf, leftRoot, rightRoot) {
  const root = leaf.getRoot();
  if (root === leftRoot) return "left";
  if (root === rightRoot) return "right";
  return "main";
}
function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

// src/diagnostics/LifecycleProbe.ts
var LifecycleProbe = class {
  constructor(app, host) {
    this.app = app;
    this.host = host;
  }
  async runRoundTrip() {
    const originalId = this.host.getActiveWorkspaceId();
    const targetId = this.host.getNextWorkspaceId();
    if (!targetId || targetId === originalId) throw new Error("Create at least two workspaces before running the probe");
    const before = this.snapshot();
    const closeCalls = [];
    const restoreHooks = this.instrumentOnClose(closeCalls);
    try {
      await this.host.switchTo(targetId);
      await this.host.switchTo(originalId);
    } finally {
      restoreHooks();
    }
    const after = this.snapshot();
    return this.compare(before, after, closeCalls, originalId);
  }
  snapshot() {
    const result = /* @__PURE__ */ new Map();
    for (const group of this.host.getRuntimeGroups()) {
      for (const leaf of group.leaves) {
        const leafId = getLeafId(leaf);
        if (!leafId) continue;
        result.set(leafId, {
          leafId,
          leaf,
          view: leaf.view,
          viewType: leaf.view.getViewType(),
          deferred: leaf.isDeferred,
          groupElement: group.element,
          bounds: group.element.getBoundingClientRect()
        });
      }
    }
    return result;
  }
  instrumentOnClose(closeCalls) {
    const restorers = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (typeof view.onClose !== "function") return;
      const original = view.onClose;
      const leafId = getLeafId(leaf);
      const viewType = view.getViewType();
      view.onClose = function() {
        closeCalls.push({ leafId, viewType });
        return original.call(this);
      };
      restorers.push(() => {
        if (view.onClose !== original) view.onClose = original;
      });
    });
    return () => restorers.reverse().forEach((restore) => restore());
  }
  compare(before, after, onCloseCalls, expectedWorkspaceId) {
    let leafIdentityPreserved = true;
    let viewIdentityPreserved = true;
    let groupIdentityPreserved = true;
    let sizesRestored = true;
    const changedViews = [];
    const notes = [];
    for (const [leafId, first] of before) {
      const second = after.get(leafId);
      if (!second || second.leaf !== first.leaf) leafIdentityPreserved = false;
      if (!second || second.groupElement !== first.groupElement) groupIdentityPreserved = false;
      if (second && !first.deferred && !second.deferred && second.view !== first.view) {
        viewIdentityPreserved = false;
        changedViews.push({ leafId, before: first.viewType, after: second.viewType });
      }
      if (second && first.bounds.width > 0 && first.bounds.height > 0) {
        const widthDelta = Math.abs(first.bounds.width - second.bounds.width);
        const heightDelta = Math.abs(first.bounds.height - second.bounds.height);
        if (widthDelta > 2 || heightDelta > 2) sizesRestored = false;
      }
    }
    if ([...before.values()].some((snapshot) => snapshot.deferred)) {
      notes.push("Deferred views were excluded from strict ItemView identity comparison.");
    }
    const focusRestored = this.host.getActiveWorkspaceId() === expectedWorkspaceId;
    const passed = leafIdentityPreserved && viewIdentityPreserved && groupIdentityPreserved && focusRestored && sizesRestored && onCloseCalls.length === 0;
    return {
      passed,
      leafIdentityPreserved,
      viewIdentityPreserved,
      groupIdentityPreserved,
      focusRestored,
      sizesRestored,
      onCloseCalls,
      changedViews,
      notes
    };
  }
};

// src/layout/LayoutCapture.ts
var MAX_STATE_STRING_CHARS = 8 * 1024;
var AREAS = ["main", "left", "right"];
var LayoutCapture = class {
  constructor(app) {
    this.app = app;
  }
  capture(record, groups) {
    const workspaceGroups = groups.filter((group) => group.workspaceId === record.id);
    for (const area of AREAS) {
      const captured = workspaceGroups.filter((group) => group.area === area).map((group) => this.captureGroup(group, record));
      if (captured.length > 0 || record.groups[area].length === 0) record.groups[area] = captured;
    }
    record.updatedAt = Date.now();
    record.layoutSnapshot = {
      capturedAt: Date.now(),
      groups: structuredClone(record.groups),
      topology: this.captureTopology(record),
      focusedLeafId: record.focusedLeafId,
      sidebars: structuredClone(record.sidebars)
    };
  }
  captureTopology(record) {
    const layout = this.app.workspace.getLayout();
    const leafIds = new Set(
      ["main", "left", "right"].flatMap((area) => record.groups[area].flatMap((group) => group.leafIds))
    );
    const topology = {};
    for (const area of ["main", "left", "right"]) {
      const filtered = filterLayoutNode(layout[area], leafIds);
      if (filtered) topology[area] = filtered;
    }
    return topology;
  }
  captureGroup(group, record) {
    const previous = record.groups[group.area].find((candidate) => candidate.id === group.id);
    const leafIds = group.leaves.map(getLeafId).filter(Boolean);
    const activeLeafId = previous?.activeLeafId && leafIds.includes(previous.activeLeafId) ? previous.activeLeafId : record.activeLeafId && leafIds.includes(record.activeLeafId) ? record.activeLeafId : leafIds[0];
    const rect = group.element.getBoundingClientRect();
    const bounds = rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : previous?.bounds;
    return {
      id: group.id,
      area: group.area,
      leafIds,
      activeLeafId,
      bounds,
      views: group.leaves.map((leaf) => this.captureView(leaf))
    };
  }
  captureView(leaf) {
    const viewState = this.safeViewState(leaf);
    const rawFile = viewState.state?.file;
    const filePath = typeof rawFile === "string" ? rawFile : void 0;
    const viewType = viewState.type || leaf.view.getViewType();
    return {
      leafId: getLeafId(leaf),
      viewType,
      title: leaf.getDisplayText() || viewType || "Untitled",
      filePath,
      viewState,
      restorePolicy: this.restorePolicy(viewType, filePath)
    };
  }
  safeViewState(leaf) {
    try {
      const state = leaf.getViewState();
      const serialized = JSON.stringify(
        { type: state.type, state: state.state, active: state.active, pinned: state.pinned },
        (_key, value) => typeof value === "string" && value.length > MAX_STATE_STRING_CHARS ? void 0 : value
      );
      return JSON.parse(serialized);
    } catch (error) {
      console.warn("[Live Workspaces] Failed to capture view state", error);
      return { type: leaf.view.getViewType(), state: {} };
    }
  }
  restorePolicy(viewType, filePath) {
    if (filePath) return "exact";
    if (viewType === "empty" || viewType === "webviewer" || viewType === "canvas") return "recreate";
    if (viewType.includes("copilot")) return "manual";
    return "recreate";
  }
};
function filterLayoutNode(value, ownedLeafIds) {
  if (!value || typeof value !== "object") return null;
  const node = value;
  const type = typeof node.type === "string" ? node.type : "unknown";
  const id = typeof node.id === "string" ? node.id : void 0;
  if (type === "leaf") return id && ownedLeafIds.has(id) ? { type, id } : null;
  const rawChildren = Array.isArray(node.children) ? node.children : [];
  const children = rawChildren.map((child) => filterLayoutNode(child, ownedLeafIds)).filter((child) => child !== null);
  if (rawChildren.length > 0 && children.length === 0) return null;
  const snapshot = { type };
  if (id) snapshot.id = id;
  if (typeof node.direction === "string") snapshot.direction = node.direction;
  if (typeof node.width === "number") snapshot.width = node.width;
  if (typeof node.height === "number") snapshot.height = node.height;
  if (children.length > 0) snapshot.children = children;
  if (type === "tabs" && children.length > 0) {
    const rawIndex = typeof node.currentTab === "number" ? node.currentTab : 0;
    const selectedId = rawChildren[rawIndex]?.id;
    const filteredIndex = children.findIndex((child) => child.id === selectedId);
    snapshot.currentTab = filteredIndex >= 0 ? filteredIndex : 0;
  }
  return snapshot;
}

// src/layout/PaneVisibility.ts
var PaneVisibility = class {
  projectionEnabled = false;
  async apply(activeWorkspaceId, groups) {
    const targetMain = groups.filter((group) => group.workspaceId === activeWorkspaceId && group.area === "main");
    if (targetMain.length === 0) throw new Error("Target workspace has no live main group");
    document.body.classList.add("live-workspaces-enabled");
    document.body.classList.remove("live-workspaces-fail-safe");
    document.body.dataset.liveWorkspaceActive = activeWorkspaceId;
    this.projectionEnabled = true;
    let hiddenPanes = 0;
    let shownPanes = 0;
    for (const group of groups) {
      const visible = group.workspaceId === activeWorkspaceId;
      const wasHidden = group.element.classList.contains("live-workspace-hidden-pane");
      if (!visible && !wasHidden) hiddenPanes += 1;
      if (visible && wasHidden) shownPanes += 1;
      group.element.classList.toggle("live-workspace-hidden-pane", !visible);
      group.element.classList.toggle("live-workspace-visible-pane", visible);
      group.element.setAttribute("aria-hidden", visible ? "false" : "true");
    }
    await nextAnimationFrame();
    await nextAnimationFrame();
    const visibleMain = targetMain.some((group) => {
      const style = getComputedStyle(group.element);
      return style.display !== "none" && group.element.getClientRects().length > 0;
    });
    if (!visibleMain) throw new Error("CSS projection produced no visible main group");
    return { hiddenPanes, shownPanes };
  }
  showAll(groups) {
    this.projectionEnabled = false;
    document.body.classList.remove("live-workspaces-enabled");
    document.body.classList.add("live-workspaces-fail-safe");
    delete document.body.dataset.liveWorkspaceActive;
    for (const group of groups) {
      group.element.classList.remove("live-workspace-hidden-pane", "live-workspace-visible-pane");
      group.element.removeAttribute("aria-hidden");
    }
  }
  dispose(groups) {
    this.showAll(groups);
    document.body.classList.remove("live-workspaces-fail-safe");
  }
  get isEnabled() {
    return this.projectionEnabled;
  }
};

// src/layout/LayoutRestore.ts
var LayoutRestore = class {
  constructor(app) {
    this.app = app;
  }
  async restore(record, ownership) {
    const snapshot = record.layoutSnapshot;
    if (!snapshot) throw new Error(`Workspace ${record.name} has no restorable snapshot`);
    const existingGroupIds = new Set(ownership.getGroupsForWorkspace(record.id).map((group) => group.id));
    for (const area of ["main", "left", "right"]) {
      for (const group of snapshot.groups[area]) {
        if (existingGroupIds.has(group.id)) continue;
        await this.restoreGroup(record.id, group, ownership);
        existingGroupIds.add(group.id);
      }
    }
  }
  async restoreGroup(workspaceId, group, ownership) {
    const firstLeaf = this.createGroupLeaf(group.area);
    ownership.bindLeaf(firstLeaf, workspaceId, group.area, group.id);
    this.hideDuringRestore(firstLeaf);
    const views = group.views.length > 0 ? group.views : [{ viewState: { type: "empty", state: {} } }];
    for (let index = 0; index < views.length; index += 1) {
      const saved = views[index];
      if (!saved) continue;
      const leaf = index === 0 ? firstLeaf : this.createTabInGroup(firstLeaf);
      ownership.bindLeaf(leaf, workspaceId, group.area, group.id);
      this.hideDuringRestore(leaf);
      await leaf.setViewState(saved.viewState);
    }
  }
  createGroupLeaf(area) {
    if (area === "left") {
      const leaf = this.app.workspace.getLeftLeaf(true);
      if (leaf) return leaf;
    }
    if (area === "right") {
      const leaf = this.app.workspace.getRightLeaf(true);
      if (leaf) return leaf;
    }
    const anchor = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit) ?? this.app.workspace.getLeaf(false);
    return this.app.workspace.createLeafBySplit(anchor, "vertical");
  }
  createTabInGroup(anchor) {
    this.app.workspace.setActiveLeaf(anchor, { focus: false });
    return this.app.workspace.getLeaf("tab");
  }
  hideDuringRestore(leaf) {
    leaf.view.containerEl.closest(".workspace-tabs")?.classList.add("live-workspace-hidden-pane");
  }
};

// src/sidebar/SidebarManager.ts
var SidebarManager = class {
  constructor(app) {
    this.app = app;
  }
  capture(record, groups) {
    record.sidebars.left = this.captureSide("left", record.sidebars.left, groups, record.id);
    record.sidebars.right = this.captureSide("right", record.sidebars.right, groups, record.id);
  }
  apply(record) {
    this.applySide("left", record.sidebars.left);
    this.applySide("right", record.sidebars.right);
  }
  captureSide(side, previous, groups, workspaceId) {
    const dock = this.getDock(side);
    const element = this.getDockElement(side);
    const area = side;
    const ownedGroups = groups.filter((group) => group.workspaceId === workspaceId && group.area === area);
    const activeLeafId = previous.activeLeafId && ownedGroups.some((group) => group.leaves.some((leaf) => getLeafId(leaf) === previous.activeLeafId)) ? previous.activeLeafId : ownedGroups[0]?.leaves[0] ? getLeafId(ownedGroups[0].leaves[0]) : void 0;
    const activeGroupId = ownedGroups.find((group) => group.leaves.some((leaf) => getLeafId(leaf) === activeLeafId))?.id;
    const width = element?.getBoundingClientRect().width;
    return {
      collapsed: dock.collapsed,
      width: width && width > 0 ? width : previous.width,
      activeGroupId,
      activeLeafId
    };
  }
  applySide(side, state) {
    const dock = this.getDock(side);
    const element = this.getDockElement(side);
    if (element && state.width && Number.isFinite(state.width) && state.width >= 120) {
      const width = `${Math.round(state.width)}px`;
      element.style.width = width;
      element.style.flexBasis = width;
    }
    if (state.collapsed && !dock.collapsed) dock.collapse();
    if (!state.collapsed && dock.collapsed) dock.expand();
  }
  getDock(side) {
    return side === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
  }
  getDockElement(side) {
    return document.querySelector(`.workspace-split.mod-${side}-split`);
  }
};

// src/types/workspace.ts
var DATA_SCHEMA_VERSION = 1;

// src/utils/ids.ts
function createId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

// src/workspace/WorkspaceOwnershipIndex.ts
var WorkspaceOwnershipIndex = class {
  constructor(app, records) {
    this.app = app;
    this.records = records;
  }
  bindings = /* @__PURE__ */ new WeakMap();
  pendingLeafBindings = /* @__PURE__ */ new Map();
  knownElements = /* @__PURE__ */ new Set();
  runtimeGroups = /* @__PURE__ */ new Map();
  leafOwners = /* @__PURE__ */ new Map();
  reconcile(activeWorkspaceId, mutationTargetId) {
    const grouped = /* @__PURE__ */ new Map();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const tabs = getTabsParent(leaf);
      const element = getTabsElement(leaf);
      if (!tabs || !element) return;
      const area = areaForLeaf(leaf, this.app.workspace.leftSplit, this.app.workspace.rightSplit);
      const existing = grouped.get(tabs);
      if (existing) {
        existing.leaves.push(leaf);
      } else {
        grouped.set(tabs, { element, leaves: [leaf], area });
      }
    });
    const nextRuntime = /* @__PURE__ */ new Map();
    const nextLeafOwners = /* @__PURE__ */ new Map();
    const validWorkspaceIds = new Set(this.records().map((record) => record.id));
    const claimedPersistedGroups = /* @__PURE__ */ new Set();
    for (const [tabs, discovered] of grouped) {
      const leafIds = discovered.leaves.map(getLeafId).filter(Boolean);
      let binding = this.bindings.get(tabs);
      if (!binding || !validWorkspaceIds.has(binding.workspaceId)) {
        binding = leafIds.map((leafId) => this.pendingLeafBindings.get(leafId)).find((candidate) => Boolean(candidate && validWorkspaceIds.has(candidate.workspaceId)));
      }
      if (!binding || !validWorkspaceIds.has(binding.workspaceId)) {
        const datasetWorkspace = discovered.element.dataset.liveWorkspaceId;
        const datasetGroup = discovered.element.dataset.liveWorkspaceGroup;
        if (datasetWorkspace && datasetGroup && validWorkspaceIds.has(datasetWorkspace)) {
          binding = { id: datasetGroup, workspaceId: datasetWorkspace, area: discovered.area };
        }
      }
      if (!binding || !validWorkspaceIds.has(binding.workspaceId)) {
        binding = this.findPersistedBinding(discovered.leaves, discovered.area, claimedPersistedGroups);
      }
      if (!binding) {
        binding = {
          id: createId("group"),
          workspaceId: mutationTargetId && validWorkspaceIds.has(mutationTargetId) ? mutationTargetId : activeWorkspaceId,
          area: discovered.area
        };
      }
      binding.area = discovered.area;
      claimedPersistedGroups.add(binding.id);
      this.bindings.set(tabs, binding);
      this.markElement(discovered.element, binding);
      this.keepProjectionConsistent(discovered.element, binding.workspaceId, activeWorkspaceId);
      const runtime = {
        id: binding.id,
        workspaceId: binding.workspaceId,
        area: discovered.area,
        tabs,
        element: discovered.element,
        leaves: discovered.leaves
      };
      nextRuntime.set(binding.id, runtime);
      for (const leafId of leafIds) {
        nextLeafOwners.set(leafId, binding);
        this.pendingLeafBindings.delete(leafId);
      }
    }
    for (const element of this.knownElements) {
      if (![...grouped.values()].some((group) => group.element === element)) this.clearElement(element);
    }
    this.knownElements.clear();
    for (const group of nextRuntime.values()) this.knownElements.add(group.element);
    this.runtimeGroups = nextRuntime;
    this.leafOwners = nextLeafOwners;
    return this.getAllGroups();
  }
  bindLeaf(leaf, workspaceId, area, groupId) {
    const tabs = getTabsParent(leaf);
    const element = getTabsElement(leaf);
    const resolvedArea = area ?? areaForLeaf(leaf, this.app.workspace.leftSplit, this.app.workspace.rightSplit);
    const leafId = getLeafId(leaf);
    const binding = {
      id: groupId ?? (tabs ? this.bindings.get(tabs)?.id : void 0) ?? this.pendingLeafBindings.get(leafId)?.id ?? createId("group"),
      workspaceId,
      area: resolvedArea
    };
    if (leafId) this.pendingLeafBindings.set(leafId, binding);
    if (!tabs || !element) return null;
    this.bindings.set(tabs, binding);
    this.markElement(element, binding);
    return {
      id: binding.id,
      workspaceId,
      area: resolvedArea,
      tabs,
      element,
      leaves: [leaf]
    };
  }
  getAllGroups() {
    return [...this.runtimeGroups.values()];
  }
  getGroupsForWorkspace(workspaceId, area) {
    return this.getAllGroups().filter(
      (group) => group.workspaceId === workspaceId && (area === void 0 || group.area === area)
    );
  }
  getWorkspaceIdForLeaf(leaf) {
    const binding = this.leafOwners.get(getLeafId(leaf));
    return binding?.workspaceId;
  }
  getGroupForLeaf(leaf) {
    const binding = this.leafOwners.get(getLeafId(leaf));
    return binding ? this.runtimeGroups.get(binding.id) : void 0;
  }
  releaseWorkspace(workspaceId) {
    for (const group of this.getGroupsForWorkspace(workspaceId)) {
      this.clearElement(group.element);
      this.runtimeGroups.delete(group.id);
      for (const leaf of group.leaves) this.leafOwners.delete(getLeafId(leaf));
    }
    for (const [leafId, binding] of this.pendingLeafBindings) {
      if (binding.workspaceId === workspaceId) this.pendingLeafBindings.delete(leafId);
    }
  }
  dispose() {
    for (const element of this.knownElements) this.clearElement(element);
    this.knownElements.clear();
    this.runtimeGroups.clear();
    this.leafOwners.clear();
    this.pendingLeafBindings.clear();
  }
  findPersistedBinding(leaves, area, claimed) {
    const leafIds = leaves.map(getLeafId).filter(Boolean);
    const signatures = leaves.map((leaf) => this.viewSignature(leaf));
    let best;
    for (const workspace of this.records()) {
      for (const group of workspace.groups[area]) {
        if (claimed.has(group.id)) continue;
        let score = group.leafIds.filter((leafId) => leafIds.includes(leafId)).length * 100;
        const savedSignatures = group.views.map((view) => `${view.viewType}:${view.filePath ?? ""}`);
        score += signatures.filter((signature) => savedSignatures.includes(signature)).length * 10;
        score -= Math.abs(signatures.length - savedSignatures.length);
        if (score > 0 && (!best || score > best.score)) {
          best = { binding: { id: group.id, workspaceId: workspace.id, area }, score };
        }
      }
    }
    return best?.binding;
  }
  viewSignature(leaf) {
    try {
      const state = leaf.getViewState();
      const file = typeof state.state?.file === "string" ? state.state.file : "";
      return `${state.type}:${file}`;
    } catch {
      return `${leaf.view.getViewType()}:`;
    }
  }
  markElement(element, binding) {
    element.dataset.liveWorkspaceId = binding.workspaceId;
    element.dataset.liveWorkspaceGroup = binding.id;
    element.dataset.liveWorkspaceArea = binding.area;
    element.classList.add("live-workspace-owned-pane");
    this.knownElements.add(element);
  }
  keepProjectionConsistent(element, workspaceId, activeWorkspaceId) {
    if (!document.body.classList.contains("live-workspaces-enabled")) return;
    const visible = workspaceId === activeWorkspaceId;
    element.classList.toggle("live-workspace-hidden-pane", !visible);
    element.classList.toggle("live-workspace-visible-pane", visible);
    element.setAttribute("aria-hidden", visible ? "false" : "true");
  }
  clearElement(element) {
    delete element.dataset.liveWorkspaceId;
    delete element.dataset.liveWorkspaceGroup;
    delete element.dataset.liveWorkspaceArea;
    element.classList.remove(
      "live-workspace-owned-pane",
      "live-workspace-hidden-pane",
      "live-workspace-visible-pane"
    );
  }
};

// src/workspace/WorkspaceSwitcher.ts
var WorkspaceSwitcher = class {
  constructor(host) {
    this.host = host;
  }
  running = false;
  pending = null;
  drainPromise = null;
  generation = 0;
  switchTo(targetId) {
    if (!this.host.hasWorkspace(targetId)) return Promise.reject(new Error(`Unknown workspace: ${targetId}`));
    this.pending = { targetId, generation: ++this.generation };
    if (!this.drainPromise) this.drainPromise = this.drain();
    return this.drainPromise;
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const { targetId, generation } = this.pending;
        this.pending = null;
        if (targetId === this.host.getActiveWorkspaceId()) continue;
        await this.perform(targetId, generation);
      }
    } catch (error) {
      this.pending = null;
      this.host.failSafe(error);
      throw error;
    } finally {
      this.running = false;
      this.drainPromise = null;
      if (this.pending) this.drainPromise = this.drain();
    }
  }
  async perform(targetId, generation) {
    const outgoingId = this.host.getActiveWorkspaceId();
    await this.host.ensureRuntime(targetId);
    if (generation !== this.generation) return;
    await this.host.reconcileNow();
    if (generation !== this.generation) return;
    this.host.captureWorkspace(outgoingId);
    const sourceGroups = this.host.getOwnedGroupDiagnostics(outgoingId);
    const targetGroups = this.host.getOwnedGroupDiagnostics(targetId);
    const projection = await this.host.projectWorkspace(targetId);
    const focusLeaf = this.host.resolveFocusLeaf(targetId);
    this.host.restoreSidebar(targetId);
    if (focusLeaf) this.host.activateLeaf(focusLeaf);
    this.host.commitActiveWorkspace(targetId);
    console.info("[Live Workspaces] Switch diagnostic", {
      fromWorkspaceId: outgoingId,
      toWorkspaceId: targetId,
      sourceOwnedGroups: sourceGroups,
      targetOwnedGroups: targetGroups,
      hiddenPanesCount: projection.hiddenPanes,
      shownPanesCount: projection.shownPanes,
      resultingActiveWorkspaceId: this.host.getActiveWorkspaceId()
    });
  }
};

// src/workspace/WorkspaceManager.ts
var RECONCILE_DEBOUNCE_MS = 120;
var WorkspaceManager = class _WorkspaceManager {
  constructor(plugin, persistence, data) {
    this.plugin = plugin;
    this.persistence = persistence;
    this.data = data;
    this.normalizeData();
    this.ownership = new WorkspaceOwnershipIndex(plugin.app, () => this.data.workspaces);
    this.capture = new LayoutCapture(plugin.app);
    this.restore = new LayoutRestore(plugin.app);
    this.sidebars = new SidebarManager(plugin.app);
    this.switcher = new WorkspaceSwitcher(this);
    this.probe = new LifecycleProbe(plugin.app, this);
  }
  ownership;
  capture;
  restore;
  visibility = new PaneVisibility();
  sidebars;
  switcher;
  probe;
  mutationTargetId;
  reconcileTimer = null;
  reconcilePromise = null;
  reconcileQueued = false;
  initialized = false;
  statusElement = null;
  resolveReady;
  ready = new Promise((resolve) => this.resolveReady = resolve);
  static initialData() {
    const workspace = createWorkspaceRecord("Workspace 1", 0, 1);
    return { schemaVersion: DATA_SCHEMA_VERSION, activeWorkspaceId: workspace.id, workspaces: [workspace] };
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    void this.initializeRuntime();
  }
  async initializeRuntime() {
    try {
      await this.reconcileNow();
      const activeId = this.getActiveWorkspaceId();
      if (this.ownership.getGroupsForWorkspace(activeId, "main").length === 0) {
        await this.ensureRuntime(activeId);
        await this.reconcileNow();
      }
      await this.projectWorkspace(activeId);
      this.restoreSidebar(activeId);
      this.captureWorkspace(activeId);
      this.registerRuntimeEvents();
      this.updateStatus();
      this.resolveReady();
    } catch (error) {
      this.failSafe(error);
      this.resolveReady();
    }
  }
  attachStatusElement(element) {
    this.statusElement = element;
    element.addClass("mod-clickable");
    element.setAttr("aria-label", "Switch live workspace");
    this.plugin.registerDomEvent(element, "click", () => {
      const app = this.plugin.app;
      app.commands.executeCommandById("live-workspaces:quick-switcher");
    });
    this.updateStatus();
  }
  getWorkspaces() {
    return this.data.workspaces.slice().sort((a, b) => a.order - b.order);
  }
  getActiveWorkspaceId() {
    return this.data.activeWorkspaceId;
  }
  getActiveWorkspace() {
    return this.requireWorkspace(this.data.activeWorkspaceId);
  }
  getWorkspaceBySlot(slot) {
    return this.data.workspaces.find((workspace) => workspace.hotkeySlot === slot);
  }
  hasWorkspace(id) {
    return this.data.workspaces.some((workspace) => workspace.id === id);
  }
  suggestWorkspaceName() {
    let number = this.data.workspaces.length + 1;
    while (this.data.workspaces.some((workspace) => workspace.name === `Workspace ${number}`)) number += 1;
    return `Workspace ${number}`;
  }
  async createWorkspace(name) {
    await this.ready;
    await this.reconcileNow();
    this.captureWorkspace(this.getActiveWorkspaceId());
    const slot = firstFreeSlot(this.data.workspaces);
    const record = createWorkspaceRecord(name, this.data.workspaces.length, slot);
    const current = this.getActiveWorkspace();
    record.sidebars = structuredClone(current.sidebars);
    this.data.workspaces.push(record);
    try {
      await this.createRuntimeShell(record.id);
      this.captureWorkspace(record.id);
    } catch (error) {
      this.ownership.releaseWorkspace(record.id);
      this.data.workspaces = this.data.workspaces.filter((workspace) => workspace.id !== record.id);
      this.failSafe(error);
      throw error;
    }
    await this.switchTo(record.id);
    new import_obsidian3.Notice(`Created live workspace \u201C${record.name}\u201D`);
  }
  renameWorkspace(id, name) {
    const workspace = this.requireWorkspace(id);
    workspace.name = name.trim() || workspace.name;
    workspace.updatedAt = Date.now();
    this.scheduleSave();
    this.updateStatus();
  }
  async deleteWorkspace(id) {
    await this.ready;
    if (this.data.workspaces.length <= 1) throw new Error("Cannot delete the last workspace");
    const deleted = this.requireWorkspace(id);
    if (id === this.getActiveWorkspaceId()) {
      const replacement = this.getWorkspaces().find((workspace) => workspace.id !== id);
      if (!replacement) return;
      await this.switchTo(replacement.id);
    }
    const leaves = /* @__PURE__ */ new Set();
    for (const group of this.ownership.getGroupsForWorkspace(id)) {
      for (const leaf of group.leaves) leaves.add(leaf);
    }
    this.ownership.releaseWorkspace(id);
    this.data.workspaces = this.data.workspaces.filter((workspace) => workspace.id !== id);
    this.reindexOrders();
    for (const leaf of leaves) leaf.detach();
    await this.reconcileNow();
    this.scheduleSave();
    new import_obsidian3.Notice(`Deleted live workspace \u201C${deleted.name}\u201D`);
  }
  async switchTo(id) {
    await this.ready;
    await this.switcher.switchTo(id);
  }
  async switchNext() {
    const id = this.getNextWorkspaceId();
    if (id) await this.switchTo(id);
  }
  async switchPrevious() {
    await this.ready;
    const workspaces = this.getWorkspaces();
    const current = workspaces.findIndex((workspace) => workspace.id === this.getActiveWorkspaceId());
    const previous = workspaces[(current - 1 + workspaces.length) % workspaces.length];
    if (previous) await this.switchTo(previous.id);
  }
  getNextWorkspaceId() {
    const workspaces = this.getWorkspaces();
    if (workspaces.length < 2) return workspaces[0]?.id ?? null;
    const current = workspaces.findIndex((workspace) => workspace.id === this.getActiveWorkspaceId());
    return workspaces[(current + 1) % workspaces.length]?.id ?? null;
  }
  async ensureRuntime(id) {
    if (this.ownership.getGroupsForWorkspace(id, "main").length > 0) return;
    const workspace = this.requireWorkspace(id);
    const hasRestorableGroups = ["main", "left", "right"].some(
      (area) => (workspace.layoutSnapshot?.groups[area].length ?? 0) > 0
    );
    if (!hasRestorableGroups) {
      await this.createRuntimeShell(id);
    } else {
      this.mutationTargetId = id;
      try {
        await this.restore.restore(workspace, this.ownership);
        await this.waitForOwnedMainGroup(id);
      } finally {
        this.mutationTargetId = void 0;
      }
    }
    if (this.ownership.getGroupsForWorkspace(id, "main").length === 0) {
      throw new Error(`Workspace ${workspace.name} has no live main group after runtime creation`);
    }
    this.captureWorkspace(id);
  }
  async reconcileNow() {
    if (this.reconcilePromise) {
      this.reconcileQueued = true;
      return this.reconcilePromise;
    }
    this.reconcilePromise = this.runReconcileLoop();
    try {
      await this.reconcilePromise;
    } finally {
      this.reconcilePromise = null;
    }
  }
  async runReconcileLoop() {
    do {
      this.reconcileQueued = false;
      this.ownership.reconcile(this.getActiveWorkspaceId(), this.mutationTargetId);
      this.captureWorkspace(this.getActiveWorkspaceId());
      await Promise.resolve();
    } while (this.reconcileQueued);
  }
  captureWorkspace(id) {
    const workspace = this.requireWorkspace(id);
    const groups = this.ownership.getAllGroups();
    if (id === this.getActiveWorkspaceId()) this.sidebars.capture(workspace, groups);
    this.capture.capture(workspace, groups);
    this.scheduleSave();
  }
  getOwnedGroupDiagnostics(id) {
    return this.ownership.getGroupsForWorkspace(id).map((group) => ({
      id: group.id,
      area: group.area,
      leafIds: group.leaves.map(getLeafId).filter(Boolean)
    }));
  }
  async projectWorkspace(id) {
    return this.visibility.apply(id, this.ownership.getAllGroups());
  }
  restoreSidebar(id) {
    const workspace = this.requireWorkspace(id);
    this.sidebars.apply(workspace);
    for (const leafId of [workspace.sidebars.left.activeLeafId, workspace.sidebars.right.activeLeafId]) {
      if (!leafId) continue;
      const leaf = this.plugin.app.workspace.getLeafById(leafId);
      if (leaf && this.ownership.getWorkspaceIdForLeaf(leaf) === id) {
        this.plugin.app.workspace.setActiveLeaf(leaf, { focus: false });
      }
    }
  }
  resolveFocusLeaf(id) {
    const workspace = this.requireWorkspace(id);
    const preferredIds = [workspace.focusedLeafId, workspace.activeLeafId];
    for (const leafId of preferredIds) {
      if (!leafId) continue;
      const leaf = this.plugin.app.workspace.getLeafById(leafId);
      if (leaf && this.ownership.getWorkspaceIdForLeaf(leaf) === id) return leaf;
    }
    return this.resolveMainLeaf(id);
  }
  activateLeaf(leaf) {
    this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
  commitActiveWorkspace(id) {
    this.data.activeWorkspaceId = id;
    const record = this.requireWorkspace(id);
    record.updatedAt = Date.now();
    this.scheduleSave();
    this.updateStatus();
  }
  getRuntimeGroups() {
    return this.ownership.getAllGroups();
  }
  async runLifecycleProbe() {
    await this.ready;
    const result = await this.probe.runRoundTrip();
    if (!result.passed) this.failSafe(new Error("Lifecycle feasibility probe failed"));
    return result;
  }
  showAllPanes() {
    this.visibility.showAll(this.ownership.getAllGroups());
    new import_obsidian3.Notice("Live Workspaces fail-safe: all panes are visible", 6e3);
  }
  failSafe(error) {
    console.error("[Live Workspaces] Fail-safe activated", error);
    this.visibility.showAll(this.ownership.getAllGroups());
    new import_obsidian3.Notice("Live Workspaces encountered an error. All panes were made visible.", 1e4);
  }
  async dispose() {
    if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
    if (this.initialized) {
      for (const workspace of this.data.workspaces) this.captureWorkspace(workspace.id);
    }
    this.visibility.dispose(this.ownership.getAllGroups());
    this.ownership.dispose();
    await this.persistence.flush();
  }
  registerRuntimeEvents() {
    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.scheduleReconcile()));
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) return;
        const workspaceId = this.ownership.getWorkspaceIdForLeaf(leaf);
        if (!workspaceId) {
          this.scheduleReconcile();
          return;
        }
        const workspace = this.requireWorkspace(workspaceId);
        const leafId = getLeafId(leaf);
        workspace.activeLeafId = leafId;
        workspace.focusedLeafId = leafId;
        const group = this.ownership.getGroupForLeaf(leaf);
        const persistedGroup = group && workspace.groups[group.area].find((candidate) => candidate.id === group.id);
        if (persistedGroup) persistedGroup.activeLeafId = leafId;
        this.scheduleSave();
      })
    );
    this.plugin.registerEvent(this.plugin.app.workspace.on("resize", () => this.captureWorkspace(this.getActiveWorkspaceId())));
    this.plugin.registerInterval(window.setInterval(() => {
      for (const workspace of this.data.workspaces) this.captureWorkspace(workspace.id);
    }, 3e4));
  }
  scheduleReconcile() {
    if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = window.setTimeout(() => {
      this.reconcileTimer = null;
      void this.reconcileNow().catch((error) => this.failSafe(error));
    }, RECONCILE_DEBOUNCE_MS);
  }
  scheduleSave() {
    this.persistence.schedule(this.data);
  }
  bindAndHide(leaf, workspaceId, area) {
    const group = this.ownership.bindLeaf(leaf, workspaceId, area);
    if (group) {
      group.element.classList.add("live-workspace-hidden-pane");
      group.element.classList.remove("live-workspace-visible-pane");
    }
  }
  async createRuntimeShell(workspaceId) {
    this.mutationTargetId = workspaceId;
    try {
      const anchor = this.resolveMainLeaf(this.getActiveWorkspaceId()) ?? this.plugin.app.workspace.getLeaf(false);
      const mainLeaf = this.plugin.app.workspace.createLeafBySplit(anchor, "vertical");
      this.bindAndHide(mainLeaf, workspaceId, "main");
      const leftLeaf = this.plugin.app.workspace.getLeftLeaf(true);
      if (leftLeaf) this.bindAndHide(leftLeaf, workspaceId, "left");
      const rightLeaf = this.plugin.app.workspace.getRightLeaf(true);
      if (rightLeaf) this.bindAndHide(rightLeaf, workspaceId, "right");
      await this.waitForOwnedMainGroup(workspaceId);
    } finally {
      this.mutationTargetId = void 0;
    }
  }
  async waitForOwnedMainGroup(workspaceId) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await nextAnimationFrame();
      await this.reconcileNow();
      if (this.ownership.getGroupsForWorkspace(workspaceId, "main").length > 0) return;
    }
    throw new Error(`Timed out waiting for a live main group for workspace ${workspaceId}`);
  }
  resolveMainLeaf(workspaceId) {
    const groups = this.ownership.getGroupsForWorkspace(workspaceId, "main");
    const record = this.requireWorkspace(workspaceId);
    const candidates = [record.activeLeafId, ...record.groups.main.map((group) => group.activeLeafId)].filter(Boolean);
    for (const leafId of candidates) {
      const leaf = this.plugin.app.workspace.getLeafById(leafId);
      if (leaf && this.ownership.getWorkspaceIdForLeaf(leaf) === workspaceId) return leaf;
    }
    return groups[0]?.leaves[0] ?? null;
  }
  requireWorkspace(id) {
    const workspace = this.data.workspaces.find((candidate) => candidate.id === id);
    if (!workspace) throw new Error(`Unknown workspace: ${id}`);
    return workspace;
  }
  normalizeData() {
    if (this.data.workspaces.length === 0) {
      const fallback = _WorkspaceManager.initialData();
      this.data.activeWorkspaceId = fallback.activeWorkspaceId;
      this.data.workspaces = fallback.workspaces;
    }
    if (!this.data.workspaces.some((workspace) => workspace.id === this.data.activeWorkspaceId)) {
      this.data.activeWorkspaceId = this.data.workspaces[0].id;
    }
    for (const [index, workspace] of this.data.workspaces.entries()) {
      workspace.order = index;
      workspace.groups ??= { main: [], left: [], right: [] };
      workspace.groups.main ??= [];
      workspace.groups.left ??= [];
      workspace.groups.right ??= [];
      workspace.sidebars ??= {
        left: { collapsed: false },
        right: { collapsed: false }
      };
      workspace.sidebars.left ??= { collapsed: false };
      workspace.sidebars.right ??= { collapsed: false };
    }
  }
  reindexOrders() {
    this.getWorkspaces().forEach((workspace, index) => workspace.order = index);
  }
  updateStatus() {
    if (this.statusElement) this.statusElement.textContent = `Workspace: ${this.getActiveWorkspace().name}`;
  }
};
function createWorkspaceRecord(name, order, hotkeySlot) {
  const now = Date.now();
  return {
    id: createId("workspace"),
    name,
    order,
    hotkeySlot,
    createdAt: now,
    updatedAt: now,
    groups: { main: [], left: [], right: [] },
    sidebars: {
      left: { collapsed: false },
      right: { collapsed: false }
    }
  };
}
function firstFreeSlot(workspaces) {
  for (let slot = 1; slot <= 9; slot += 1) {
    if (!workspaces.some((workspace) => workspace.hotkeySlot === slot)) return slot;
  }
  return void 0;
}

// src/workspace/WorkspacePersistence.ts
var SAVE_DEBOUNCE_MS = 400;
var WorkspacePersistence = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  timer = null;
  pending = null;
  writeQueue = Promise.resolve();
  async load() {
    const raw = await this.plugin.loadData();
    if (!this.isValid(raw)) return null;
    return raw;
  }
  schedule(data) {
    this.pending = structuredClone(data);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }
  async flush() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const data = this.pending;
    this.pending = null;
    if (!data) return this.writeQueue;
    this.writeQueue = this.writeQueue.then(() => this.plugin.saveData(data));
    await this.writeQueue;
    if (this.pending) await this.flush();
  }
  isValid(value) {
    if (!value || typeof value !== "object") return false;
    const candidate = value;
    return candidate.schemaVersion === DATA_SCHEMA_VERSION && typeof candidate.activeWorkspaceId === "string" && Array.isArray(candidate.workspaces);
  }
};

// src/main.ts
var LiveWorkspacesPlugin = class extends import_obsidian4.Plugin {
  manager = null;
  persistence = null;
  async onload() {
    if (import_obsidian4.Platform.isMobileApp) {
      new import_obsidian4.Notice("Live Workspaces currently supports desktop Obsidian only.");
      return;
    }
    this.persistence = new WorkspacePersistence(this);
    const data = await this.persistence.load() ?? WorkspaceManager.initialData();
    this.manager = new WorkspaceManager(this, this.persistence, data);
    registerWorkspaceCommands(this, this.manager);
    this.manager.attachStatusElement(this.addStatusBarItem());
    this.app.workspace.onLayoutReady(() => this.manager?.initialize());
    this.warnAboutWorkspaceManagers();
  }
  onunload() {
    if (this.manager) void this.manager.dispose();
  }
  warnAboutWorkspaceManagers() {
    const app = this.app;
    const enabled = app.plugins?.enabledPlugins;
    if (!enabled) return;
    const conflicts = ["working-tabs", "workspace-plus-plus"].filter((id) => enabled.has(id));
    if (conflicts.length > 0) {
      new import_obsidian4.Notice(
        `Live Workspaces: avoid switching layouts with ${conflicts.join(", ")} while live panes are active.`,
        1e4
      );
    }
  }
};
