import type { App, WorkspaceLeaf } from "obsidian";
import type { LiveWorkspaceRecord, PersistedGroupRecord, WorkspaceArea } from "../types/workspace";
import type { WorkspaceOwnershipIndex } from "../workspace/WorkspaceOwnershipIndex";

/**
 * Restart-only fallback. Normal switching never calls this class.
 * Obsidian normally restores the complete physical tree itself; this path is
 * used only when a persisted workspace has no surviving runtime group.
 */
export class LayoutRestore {
  constructor(private readonly app: App) {}

  async restore(record: LiveWorkspaceRecord, ownership: WorkspaceOwnershipIndex): Promise<void> {
    const snapshot = record.layoutSnapshot;
    if (!snapshot) throw new Error(`Workspace ${record.name} has no restorable snapshot`);
    const existingGroupIds = new Set(ownership.getGroupsForWorkspace(record.id).map((group) => group.id));

    for (const area of ["main", "left", "right"] as WorkspaceArea[]) {
      for (const group of snapshot.groups[area]) {
        if (existingGroupIds.has(group.id)) continue;
        await this.restoreGroup(record.id, group, ownership);
        existingGroupIds.add(group.id);
      }
    }
  }

  private async restoreGroup(
    workspaceId: string,
    group: PersistedGroupRecord,
    ownership: WorkspaceOwnershipIndex
  ): Promise<void> {
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
      // Explicitly isolated here: this is restart recovery, never a live switch.
      await leaf.setViewState(saved.viewState);
    }
  }

  private createGroupLeaf(area: WorkspaceArea): WorkspaceLeaf {
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

  private createTabInGroup(anchor: WorkspaceLeaf): WorkspaceLeaf {
    this.app.workspace.setActiveLeaf(anchor, { focus: false });
    return this.app.workspace.getLeaf("tab");
  }

  private hideDuringRestore(leaf: WorkspaceLeaf): void {
    leaf.view.containerEl.closest<HTMLElement>(".workspace-tabs")?.classList.add("live-workspace-hidden-pane");
  }
}
