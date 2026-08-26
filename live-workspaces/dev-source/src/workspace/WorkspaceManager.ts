import { Notice, type Plugin, type WorkspaceLeaf } from "obsidian";
import { LifecycleProbe } from "../diagnostics/LifecycleProbe";
import { LayoutCapture } from "../layout/LayoutCapture";
import { PaneVisibility, type PaneProjectionResult } from "../layout/PaneVisibility";
import { LayoutRestore } from "../layout/LayoutRestore";
import { SidebarManager } from "../sidebar/SidebarManager";
import {
  DATA_SCHEMA_VERSION,
  type LifecycleProbeResult,
  type LiveWorkspaceRecord,
  type LiveWorkspacesData,
  type RuntimeGroup,
  type WorkspaceArea
} from "../types/workspace";
import { createId } from "../utils/ids";
import { getLeafId, nextAnimationFrame } from "../utils/leaf";
import { WorkspaceOwnershipIndex } from "./WorkspaceOwnershipIndex";
import type { WorkspacePersistence } from "./WorkspacePersistence";
import { WorkspaceSwitcher, type SwitchGroupDiagnostic, type WorkspaceSwitchHost } from "./WorkspaceSwitcher";

const RECONCILE_DEBOUNCE_MS = 120;

export class WorkspaceManager implements WorkspaceSwitchHost {
  private readonly ownership: WorkspaceOwnershipIndex;
  private readonly capture: LayoutCapture;
  private readonly restore: LayoutRestore;
  private readonly visibility = new PaneVisibility();
  private readonly sidebars: SidebarManager;
  private readonly switcher: WorkspaceSwitcher;
  private readonly probe: LifecycleProbe;
  private mutationTargetId: string | undefined;
  private reconcileTimer: number | null = null;
  private reconcilePromise: Promise<void> | null = null;
  private reconcileQueued = false;
  private initialized = false;
  private statusElement: HTMLElement | null = null;
  private resolveReady!: () => void;
  private readonly ready = new Promise<void>((resolve) => (this.resolveReady = resolve));

  constructor(
    private readonly plugin: Plugin,
    private readonly persistence: WorkspacePersistence,
    private readonly data: LiveWorkspacesData
  ) {
    this.normalizeData();
    this.ownership = new WorkspaceOwnershipIndex(plugin.app, () => this.data.workspaces);
    this.capture = new LayoutCapture(plugin.app);
    this.restore = new LayoutRestore(plugin.app);
    this.sidebars = new SidebarManager(plugin.app);
    this.switcher = new WorkspaceSwitcher(this);
    this.probe = new LifecycleProbe(plugin.app, this);
  }

  static initialData(): LiveWorkspacesData {
    const workspace = createWorkspaceRecord("Workspace 1", 0, 1);
    return { schemaVersion: DATA_SCHEMA_VERSION, activeWorkspaceId: workspace.id, workspaces: [workspace] };
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    void this.initializeRuntime();
  }

  private async initializeRuntime(): Promise<void> {
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

  attachStatusElement(element: HTMLElement): void {
    this.statusElement = element;
    element.addClass("mod-clickable");
    element.setAttr("aria-label", "Switch live workspace");
    this.plugin.registerDomEvent(element, "click", () => {
      const app = this.plugin.app as unknown as { commands: { executeCommandById(id: string): boolean } };
      app.commands.executeCommandById("live-workspaces:quick-switcher");
    });
    this.updateStatus();
  }

  getWorkspaces(): LiveWorkspaceRecord[] {
    return this.data.workspaces.slice().sort((a, b) => a.order - b.order);
  }

  getActiveWorkspaceId(): string {
    return this.data.activeWorkspaceId;
  }

  getActiveWorkspace(): LiveWorkspaceRecord {
    return this.requireWorkspace(this.data.activeWorkspaceId);
  }

  getWorkspaceBySlot(slot: number): LiveWorkspaceRecord | undefined {
    return this.data.workspaces.find((workspace) => workspace.hotkeySlot === slot);
  }

  hasWorkspace(id: string): boolean {
    return this.data.workspaces.some((workspace) => workspace.id === id);
  }

  suggestWorkspaceName(): string {
    let number = this.data.workspaces.length + 1;
    while (this.data.workspaces.some((workspace) => workspace.name === `Workspace ${number}`)) number += 1;
    return `Workspace ${number}`;
  }

  async createWorkspace(name: string): Promise<void> {
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
    new Notice(`Created live workspace “${record.name}”`);
  }

  renameWorkspace(id: string, name: string): void {
    const workspace = this.requireWorkspace(id);
    workspace.name = name.trim() || workspace.name;
    workspace.updatedAt = Date.now();
    this.scheduleSave();
    this.updateStatus();
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.ready;
    if (this.data.workspaces.length <= 1) throw new Error("Cannot delete the last workspace");
    const deleted = this.requireWorkspace(id);
    if (id === this.getActiveWorkspaceId()) {
      const replacement = this.getWorkspaces().find((workspace) => workspace.id !== id);
      if (!replacement) return;
      await this.switchTo(replacement.id);
    }

    const leaves = new Set<WorkspaceLeaf>();
    for (const group of this.ownership.getGroupsForWorkspace(id)) {
      for (const leaf of group.leaves) leaves.add(leaf);
    }
    this.ownership.releaseWorkspace(id);
    this.data.workspaces = this.data.workspaces.filter((workspace) => workspace.id !== id);
    this.reindexOrders();
    // Explicit workspace deletion is the only runtime operation that closes leaves.
    for (const leaf of leaves) leaf.detach();
    await this.reconcileNow();
    this.scheduleSave();
    new Notice(`Deleted live workspace “${deleted.name}”`);
  }

  async switchTo(id: string): Promise<void> {
    await this.ready;
    await this.switcher.switchTo(id);
  }

  async switchNext(): Promise<void> {
    const id = this.getNextWorkspaceId();
    if (id) await this.switchTo(id);
  }

  async switchPrevious(): Promise<void> {
    await this.ready;
    const workspaces = this.getWorkspaces();
    const current = workspaces.findIndex((workspace) => workspace.id === this.getActiveWorkspaceId());
    const previous = workspaces[(current - 1 + workspaces.length) % workspaces.length];
    if (previous) await this.switchTo(previous.id);
  }

  getNextWorkspaceId(): string | null {
    const workspaces = this.getWorkspaces();
    if (workspaces.length < 2) return workspaces[0]?.id ?? null;
    const current = workspaces.findIndex((workspace) => workspace.id === this.getActiveWorkspaceId());
    return workspaces[(current + 1) % workspaces.length]?.id ?? null;
  }

  async ensureRuntime(id: string): Promise<void> {
    if (this.ownership.getGroupsForWorkspace(id, "main").length > 0) return;
    const workspace = this.requireWorkspace(id);
    const hasRestorableGroups = (["main", "left", "right"] as WorkspaceArea[]).some(
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
        this.mutationTargetId = undefined;
      }
    }
    if (this.ownership.getGroupsForWorkspace(id, "main").length === 0) {
      throw new Error(`Workspace ${workspace.name} has no live main group after runtime creation`);
    }
    this.captureWorkspace(id);
  }

  async reconcileNow(): Promise<void> {
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

  private async runReconcileLoop(): Promise<void> {
    do {
      this.reconcileQueued = false;
      this.ownership.reconcile(this.getActiveWorkspaceId(), this.mutationTargetId);
      this.captureWorkspace(this.getActiveWorkspaceId());
      await Promise.resolve();
    } while (this.reconcileQueued);
  }

  captureWorkspace(id: string): void {
    const workspace = this.requireWorkspace(id);
    const groups = this.ownership.getAllGroups();
    // The native side docks are global. Their current width/collapse flags
    // describe only the visible workspace; never overwrite dormant records.
    if (id === this.getActiveWorkspaceId()) this.sidebars.capture(workspace, groups);
    this.capture.capture(workspace, groups);
    this.scheduleSave();
  }

  getOwnedGroupDiagnostics(id: string): SwitchGroupDiagnostic[] {
    return this.ownership.getGroupsForWorkspace(id).map((group) => ({
      id: group.id,
      area: group.area,
      leafIds: group.leaves.map(getLeafId).filter(Boolean)
    }));
  }

  async projectWorkspace(id: string): Promise<PaneProjectionResult> {
    return this.visibility.apply(id, this.ownership.getAllGroups());
  }

  restoreSidebar(id: string): void {
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

  resolveFocusLeaf(id: string): WorkspaceLeaf | null {
    const workspace = this.requireWorkspace(id);
    const preferredIds = [workspace.focusedLeafId, workspace.activeLeafId];
    for (const leafId of preferredIds) {
      if (!leafId) continue;
      const leaf = this.plugin.app.workspace.getLeafById(leafId);
      if (leaf && this.ownership.getWorkspaceIdForLeaf(leaf) === id) return leaf;
    }
    return this.resolveMainLeaf(id);
  }

  activateLeaf(leaf: WorkspaceLeaf): void {
    this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  commitActiveWorkspace(id: string): void {
    this.data.activeWorkspaceId = id;
    const record = this.requireWorkspace(id);
    record.updatedAt = Date.now();
    this.scheduleSave();
    this.updateStatus();
  }

  getRuntimeGroups(): RuntimeGroup[] {
    return this.ownership.getAllGroups();
  }

  async runLifecycleProbe(): Promise<LifecycleProbeResult> {
    await this.ready;
    const result = await this.probe.runRoundTrip();
    if (!result.passed) this.failSafe(new Error("Lifecycle feasibility probe failed"));
    return result;
  }

  showAllPanes(): void {
    this.visibility.showAll(this.ownership.getAllGroups());
    new Notice("Live Workspaces fail-safe: all panes are visible", 6000);
  }

  failSafe(error: unknown): void {
    console.error("[Live Workspaces] Fail-safe activated", error);
    this.visibility.showAll(this.ownership.getAllGroups());
    new Notice("Live Workspaces encountered an error. All panes were made visible.", 10000);
  }

  async dispose(): Promise<void> {
    if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
    if (this.initialized) {
      for (const workspace of this.data.workspaces) this.captureWorkspace(workspace.id);
    }
    this.visibility.dispose(this.ownership.getAllGroups());
    this.ownership.dispose();
    await this.persistence.flush();
  }

  private registerRuntimeEvents(): void {
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
    }, 30_000));
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = window.setTimeout(() => {
      this.reconcileTimer = null;
      void this.reconcileNow().catch((error) => this.failSafe(error));
    }, RECONCILE_DEBOUNCE_MS);
  }

  private scheduleSave(): void {
    this.persistence.schedule(this.data);
  }

  private bindAndHide(leaf: WorkspaceLeaf, workspaceId: string, area: WorkspaceArea): void {
    const group = this.ownership.bindLeaf(leaf, workspaceId, area);
    if (group) {
      group.element.classList.add("live-workspace-hidden-pane");
      group.element.classList.remove("live-workspace-visible-pane");
    }
  }

  private async createRuntimeShell(workspaceId: string): Promise<void> {
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
      this.mutationTargetId = undefined;
    }
  }

  private async waitForOwnedMainGroup(workspaceId: string): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await nextAnimationFrame();
      await this.reconcileNow();
      if (this.ownership.getGroupsForWorkspace(workspaceId, "main").length > 0) return;
    }
    throw new Error(`Timed out waiting for a live main group for workspace ${workspaceId}`);
  }

  private resolveMainLeaf(workspaceId: string): WorkspaceLeaf | null {
    const groups = this.ownership.getGroupsForWorkspace(workspaceId, "main");
    const record = this.requireWorkspace(workspaceId);
    const candidates = [record.activeLeafId, ...record.groups.main.map((group) => group.activeLeafId)].filter(Boolean) as string[];
    for (const leafId of candidates) {
      const leaf = this.plugin.app.workspace.getLeafById(leafId);
      if (leaf && this.ownership.getWorkspaceIdForLeaf(leaf) === workspaceId) return leaf;
    }
    return groups[0]?.leaves[0] ?? null;
  }

  private requireWorkspace(id: string): LiveWorkspaceRecord {
    const workspace = this.data.workspaces.find((candidate) => candidate.id === id);
    if (!workspace) throw new Error(`Unknown workspace: ${id}`);
    return workspace;
  }

  private normalizeData(): void {
    if (this.data.workspaces.length === 0) {
      const fallback = WorkspaceManager.initialData();
      this.data.activeWorkspaceId = fallback.activeWorkspaceId;
      this.data.workspaces = fallback.workspaces;
    }
    if (!this.data.workspaces.some((workspace) => workspace.id === this.data.activeWorkspaceId)) {
      this.data.activeWorkspaceId = this.data.workspaces[0]!.id;
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

  private reindexOrders(): void {
    this.getWorkspaces().forEach((workspace, index) => (workspace.order = index));
  }

  private updateStatus(): void {
    if (this.statusElement) this.statusElement.textContent = `Workspace: ${this.getActiveWorkspace().name}`;
  }
}

function createWorkspaceRecord(name: string, order: number, hotkeySlot?: number): LiveWorkspaceRecord {
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

function firstFreeSlot(workspaces: LiveWorkspaceRecord[]): number | undefined {
  for (let slot = 1; slot <= 9; slot += 1) {
    if (!workspaces.some((workspace) => workspace.hotkeySlot === slot)) return slot;
  }
  return undefined;
}
