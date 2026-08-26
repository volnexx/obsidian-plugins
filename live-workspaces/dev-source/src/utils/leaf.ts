import type { WorkspaceLeaf, WorkspaceTabs } from "obsidian";
import type { WorkspaceArea } from "../types/workspace";

export function getLeafId(leaf: WorkspaceLeaf): string {
  return (leaf as unknown as { id?: string }).id ?? "";
}

export function getTabsElement(leaf: WorkspaceLeaf): HTMLElement | null {
  return leaf.view.containerEl.closest<HTMLElement>(".workspace-tabs");
}

export function getTabsParent(leaf: WorkspaceLeaf): WorkspaceTabs | null {
  const parent = leaf.parent;
  return getTabsElement(leaf) ? (parent as WorkspaceTabs) : null;
}

export function areaForLeaf(
  leaf: WorkspaceLeaf,
  leftRoot: unknown,
  rightRoot: unknown
): WorkspaceArea {
  const root = leaf.getRoot();
  if (root === leftRoot) return "left";
  if (root === rightRoot) return "right";
  return "main";
}

export function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
