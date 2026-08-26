import type { ViewState, WorkspaceLeaf, WorkspaceTabs } from "obsidian";

export const DATA_SCHEMA_VERSION = 1;

export type WorkspaceArea = "main" | "left" | "right";

export interface PaneBounds {
  width: number;
  height: number;
}

export interface PersistedViewRecord {
  leafId: string;
  viewType: string;
  title: string;
  filePath?: string;
  viewState: ViewState;
  restorePolicy: "exact" | "recreate" | "manual" | "shared";
}

export interface PersistedGroupRecord {
  id: string;
  area: WorkspaceArea;
  leafIds: string[];
  activeLeafId?: string;
  bounds?: PaneBounds;
  views: PersistedViewRecord[];
}

export interface SidebarState {
  collapsed: boolean;
  width?: number;
  activeGroupId?: string;
  activeLeafId?: string;
}

export interface WorkspaceLayoutSnapshot {
  capturedAt: number;
  groups: Record<WorkspaceArea, PersistedGroupRecord[]>;
  topology: Partial<Record<WorkspaceArea, LayoutNodeSnapshot>>;
  focusedLeafId?: string;
  sidebars: {
    left: SidebarState;
    right: SidebarState;
  };
}

export interface LayoutNodeSnapshot {
  type: "split" | "tabs" | "leaf" | string;
  id?: string;
  direction?: "horizontal" | "vertical" | string;
  width?: number;
  height?: number;
  currentTab?: number;
  children?: LayoutNodeSnapshot[];
}

export interface LiveWorkspaceRecord {
  id: string;
  name: string;
  order: number;
  hotkeySlot?: number;
  createdAt: number;
  updatedAt: number;
  activeLeafId?: string;
  focusedLeafId?: string;
  groups: Record<WorkspaceArea, PersistedGroupRecord[]>;
  sidebars: {
    left: SidebarState;
    right: SidebarState;
  };
  layoutSnapshot?: WorkspaceLayoutSnapshot;
  /** Reserved for a future Copilot Agent View binding. */
  copilotAgentSessionId?: string;
}

export interface LiveWorkspacesData {
  schemaVersion: number;
  activeWorkspaceId: string;
  workspaces: LiveWorkspaceRecord[];
}

export interface RuntimeGroup {
  id: string;
  workspaceId: string;
  area: WorkspaceArea;
  tabs: WorkspaceTabs;
  element: HTMLElement;
  leaves: WorkspaceLeaf[];
}

export interface IdentitySnapshot {
  leafId: string;
  leaf: WorkspaceLeaf;
  view: WorkspaceLeaf["view"];
  viewType: string;
  deferred: boolean;
  groupElement: HTMLElement;
  bounds: DOMRect;
}

export interface LifecycleProbeResult {
  passed: boolean;
  leafIdentityPreserved: boolean;
  viewIdentityPreserved: boolean;
  groupIdentityPreserved: boolean;
  focusRestored: boolean;
  sizesRestored: boolean;
  onCloseCalls: Array<{ leafId: string; viewType: string }>;
  changedViews: Array<{ leafId: string; before: string; after: string }>;
  notes: string[];
}
