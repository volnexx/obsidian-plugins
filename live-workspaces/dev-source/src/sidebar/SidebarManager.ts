import type { App, WorkspaceSidedock } from "obsidian";
import type { LiveWorkspaceRecord, RuntimeGroup, SidebarState, WorkspaceArea } from "../types/workspace";
import { getLeafId } from "../utils/leaf";

type Side = "left" | "right";

interface DockLike {
  collapsed: boolean;
  collapse(): void;
  expand(): void;
}

export class SidebarManager {
  constructor(private readonly app: App) {}

  capture(record: LiveWorkspaceRecord, groups: RuntimeGroup[]): void {
    record.sidebars.left = this.captureSide("left", record.sidebars.left, groups, record.id);
    record.sidebars.right = this.captureSide("right", record.sidebars.right, groups, record.id);
  }

  apply(record: LiveWorkspaceRecord): void {
    this.applySide("left", record.sidebars.left);
    this.applySide("right", record.sidebars.right);
  }

  private captureSide(
    side: Side,
    previous: SidebarState,
    groups: RuntimeGroup[],
    workspaceId: string
  ): SidebarState {
    const dock = this.getDock(side);
    const element = this.getDockElement(side);
    const area: WorkspaceArea = side;
    const ownedGroups = groups.filter((group) => group.workspaceId === workspaceId && group.area === area);
    const activeLeafId = previous.activeLeafId && ownedGroups.some((group) => group.leaves.some((leaf) => getLeafId(leaf) === previous.activeLeafId))
      ? previous.activeLeafId
      : ownedGroups[0]?.leaves[0] ? getLeafId(ownedGroups[0].leaves[0]) : undefined;
    const activeGroupId = ownedGroups.find((group) => group.leaves.some((leaf) => getLeafId(leaf) === activeLeafId))?.id;
    const width = element?.getBoundingClientRect().width;
    return {
      collapsed: dock.collapsed,
      width: width && width > 0 ? width : previous.width,
      activeGroupId,
      activeLeafId
    };
  }

  private applySide(side: Side, state: SidebarState): void {
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

  private getDock(side: Side): DockLike {
    return (side === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit) as WorkspaceSidedock;
  }

  private getDockElement(side: Side): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.workspace-split.mod-${side}-split`);
  }
}
