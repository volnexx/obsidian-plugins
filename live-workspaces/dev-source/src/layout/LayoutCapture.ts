import type { App, ViewState, WorkspaceLeaf } from "obsidian";
import type {
  LiveWorkspaceRecord,
  PersistedGroupRecord,
  PersistedViewRecord,
  RuntimeGroup,
  LayoutNodeSnapshot,
  WorkspaceArea
} from "../types/workspace";
import { getLeafId } from "../utils/leaf";

const MAX_STATE_STRING_CHARS = 8 * 1024;
const AREAS: WorkspaceArea[] = ["main", "left", "right"];

export class LayoutCapture {
  constructor(private readonly app: App) {}

  capture(record: LiveWorkspaceRecord, groups: RuntimeGroup[]): void {
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

  private captureTopology(record: LiveWorkspaceRecord): Partial<Record<WorkspaceArea, LayoutNodeSnapshot>> {
    const layout = this.app.workspace.getLayout() as Record<string, unknown>;
    const leafIds = new Set(
      (["main", "left", "right"] as WorkspaceArea[]).flatMap((area) => record.groups[area].flatMap((group) => group.leafIds))
    );
    const topology: Partial<Record<WorkspaceArea, LayoutNodeSnapshot>> = {};
    for (const area of ["main", "left", "right"] as WorkspaceArea[]) {
      const filtered = filterLayoutNode(layout[area], leafIds);
      if (filtered) topology[area] = filtered;
    }
    return topology;
  }

  private captureGroup(group: RuntimeGroup, record: LiveWorkspaceRecord): PersistedGroupRecord {
    const previous = record.groups[group.area].find((candidate) => candidate.id === group.id);
    const leafIds = group.leaves.map(getLeafId).filter(Boolean);
    const activeLeafId = previous?.activeLeafId && leafIds.includes(previous.activeLeafId)
      ? previous.activeLeafId
      : record.activeLeafId && leafIds.includes(record.activeLeafId)
        ? record.activeLeafId
        : leafIds[0];
    const rect = group.element.getBoundingClientRect();
    const bounds = rect.width > 0 && rect.height > 0
      ? { width: rect.width, height: rect.height }
      : previous?.bounds;
    return {
      id: group.id,
      area: group.area,
      leafIds,
      activeLeafId,
      bounds,
      views: group.leaves.map((leaf) => this.captureView(leaf))
    };
  }

  private captureView(leaf: WorkspaceLeaf): PersistedViewRecord {
    const viewState = this.safeViewState(leaf);
    const rawFile = viewState.state?.file;
    const filePath = typeof rawFile === "string" ? rawFile : undefined;
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

  private safeViewState(leaf: WorkspaceLeaf): ViewState {
    try {
      const state = leaf.getViewState();
      const serialized = JSON.stringify(
        { type: state.type, state: state.state, active: state.active, pinned: state.pinned },
        (_key, value: unknown) =>
          typeof value === "string" && value.length > MAX_STATE_STRING_CHARS ? undefined : value
      );
      return JSON.parse(serialized) as ViewState;
    } catch (error) {
      console.warn("[Live Workspaces] Failed to capture view state", error);
      return { type: leaf.view.getViewType(), state: {} };
    }
  }

  private restorePolicy(viewType: string, filePath?: string): PersistedViewRecord["restorePolicy"] {
    if (filePath) return "exact";
    if (viewType === "empty" || viewType === "webviewer" || viewType === "canvas") return "recreate";
    if (viewType.includes("copilot")) return "manual";
    return "recreate";
  }
}

function filterLayoutNode(value: unknown, ownedLeafIds: Set<string>): LayoutNodeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type : "unknown";
  const id = typeof node.id === "string" ? node.id : undefined;
  if (type === "leaf") return id && ownedLeafIds.has(id) ? { type, id } : null;

  const rawChildren = Array.isArray(node.children) ? node.children : [];
  const children = rawChildren.map((child) => filterLayoutNode(child, ownedLeafIds)).filter((child): child is LayoutNodeSnapshot => child !== null);
  if (rawChildren.length > 0 && children.length === 0) return null;
  const snapshot: LayoutNodeSnapshot = { type };
  if (id) snapshot.id = id;
  if (typeof node.direction === "string") snapshot.direction = node.direction;
  if (typeof node.width === "number") snapshot.width = node.width;
  if (typeof node.height === "number") snapshot.height = node.height;
  if (children.length > 0) snapshot.children = children;
  if (type === "tabs" && children.length > 0) {
    const rawIndex = typeof node.currentTab === "number" ? node.currentTab : 0;
    const selectedId = (rawChildren[rawIndex] as { id?: unknown } | undefined)?.id;
    const filteredIndex = children.findIndex((child) => child.id === selectedId);
    snapshot.currentTab = filteredIndex >= 0 ? filteredIndex : 0;
  }
  return snapshot;
}
