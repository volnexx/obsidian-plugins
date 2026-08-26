import type { App, WorkspaceLeaf, WorkspaceTabs } from "obsidian";
import type { LiveWorkspaceRecord, RuntimeGroup, WorkspaceArea } from "../types/workspace";
import { createId } from "../utils/ids";
import { areaForLeaf, getLeafId, getTabsElement, getTabsParent } from "../utils/leaf";

interface GroupBinding {
  id: string;
  workspaceId: string;
  area: WorkspaceArea;
}

export class WorkspaceOwnershipIndex {
  private readonly bindings = new WeakMap<WorkspaceTabs, GroupBinding>();
  private readonly pendingLeafBindings = new Map<string, GroupBinding>();
  private readonly knownElements = new Set<HTMLElement>();
  private runtimeGroups = new Map<string, RuntimeGroup>();
  private leafOwners = new Map<string, GroupBinding>();

  constructor(
    private readonly app: App,
    private readonly records: () => LiveWorkspaceRecord[]
  ) {}

  reconcile(activeWorkspaceId: string, mutationTargetId?: string): RuntimeGroup[] {
    const grouped = new Map<WorkspaceTabs, { element: HTMLElement; leaves: WorkspaceLeaf[]; area: WorkspaceArea }>();

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

    const nextRuntime = new Map<string, RuntimeGroup>();
    const nextLeafOwners = new Map<string, GroupBinding>();
    const validWorkspaceIds = new Set(this.records().map((record) => record.id));
    const claimedPersistedGroups = new Set<string>();

    for (const [tabs, discovered] of grouped) {
      const leafIds = discovered.leaves.map(getLeafId).filter(Boolean);
      let binding = this.bindings.get(tabs);
      if (!binding || !validWorkspaceIds.has(binding.workspaceId)) {
        binding = leafIds
          .map((leafId) => this.pendingLeafBindings.get(leafId))
          .find((candidate): candidate is GroupBinding => Boolean(candidate && validWorkspaceIds.has(candidate.workspaceId)));
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

      const runtime: RuntimeGroup = {
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

  bindLeaf(leaf: WorkspaceLeaf, workspaceId: string, area?: WorkspaceArea, groupId?: string): RuntimeGroup | null {
    const tabs = getTabsParent(leaf);
    const element = getTabsElement(leaf);
    const resolvedArea = area ?? areaForLeaf(leaf, this.app.workspace.leftSplit, this.app.workspace.rightSplit);
    const leafId = getLeafId(leaf);
    const binding: GroupBinding = {
      id: groupId ?? (tabs ? this.bindings.get(tabs)?.id : undefined) ?? this.pendingLeafBindings.get(leafId)?.id ?? createId("group"),
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

  getAllGroups(): RuntimeGroup[] {
    return [...this.runtimeGroups.values()];
  }

  getGroupsForWorkspace(workspaceId: string, area?: WorkspaceArea): RuntimeGroup[] {
    return this.getAllGroups().filter(
      (group) => group.workspaceId === workspaceId && (area === undefined || group.area === area)
    );
  }

  getWorkspaceIdForLeaf(leaf: WorkspaceLeaf): string | undefined {
    const binding = this.leafOwners.get(getLeafId(leaf));
    return binding?.workspaceId;
  }

  getGroupForLeaf(leaf: WorkspaceLeaf): RuntimeGroup | undefined {
    const binding = this.leafOwners.get(getLeafId(leaf));
    return binding ? this.runtimeGroups.get(binding.id) : undefined;
  }

  releaseWorkspace(workspaceId: string): void {
    for (const group of this.getGroupsForWorkspace(workspaceId)) {
      this.clearElement(group.element);
      this.runtimeGroups.delete(group.id);
      for (const leaf of group.leaves) this.leafOwners.delete(getLeafId(leaf));
    }
    for (const [leafId, binding] of this.pendingLeafBindings) {
      if (binding.workspaceId === workspaceId) this.pendingLeafBindings.delete(leafId);
    }
  }

  dispose(): void {
    for (const element of this.knownElements) this.clearElement(element);
    this.knownElements.clear();
    this.runtimeGroups.clear();
    this.leafOwners.clear();
    this.pendingLeafBindings.clear();
  }

  private findPersistedBinding(
    leaves: WorkspaceLeaf[],
    area: WorkspaceArea,
    claimed: Set<string>
  ): GroupBinding | undefined {
    const leafIds = leaves.map(getLeafId).filter(Boolean);
    const signatures = leaves.map((leaf) => this.viewSignature(leaf));
    let best: { binding: GroupBinding; score: number } | undefined;
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

  private viewSignature(leaf: WorkspaceLeaf): string {
    try {
      const state = leaf.getViewState();
      const file = typeof state.state?.file === "string" ? state.state.file : "";
      return `${state.type}:${file}`;
    } catch {
      return `${leaf.view.getViewType()}:`;
    }
  }

  private markElement(element: HTMLElement, binding: GroupBinding): void {
    element.dataset.liveWorkspaceId = binding.workspaceId;
    element.dataset.liveWorkspaceGroup = binding.id;
    element.dataset.liveWorkspaceArea = binding.area;
    element.classList.add("live-workspace-owned-pane");
    this.knownElements.add(element);
  }

  private keepProjectionConsistent(element: HTMLElement, workspaceId: string, activeWorkspaceId: string): void {
    if (!document.body.classList.contains("live-workspaces-enabled")) return;
    const visible = workspaceId === activeWorkspaceId;
    element.classList.toggle("live-workspace-hidden-pane", !visible);
    element.classList.toggle("live-workspace-visible-pane", visible);
    element.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  private clearElement(element: HTMLElement): void {
    delete element.dataset.liveWorkspaceId;
    delete element.dataset.liveWorkspaceGroup;
    delete element.dataset.liveWorkspaceArea;
    element.classList.remove(
      "live-workspace-owned-pane",
      "live-workspace-hidden-pane",
      "live-workspace-visible-pane"
    );
  }
}
