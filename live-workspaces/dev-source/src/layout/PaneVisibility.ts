import type { RuntimeGroup } from "../types/workspace";
import { nextAnimationFrame } from "../utils/leaf";

export interface PaneProjectionResult {
  hiddenPanes: number;
  shownPanes: number;
}

export class PaneVisibility {
  private projectionEnabled = false;

  async apply(activeWorkspaceId: string, groups: RuntimeGroup[]): Promise<PaneProjectionResult> {
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

  showAll(groups: RuntimeGroup[]): void {
    this.projectionEnabled = false;
    document.body.classList.remove("live-workspaces-enabled");
    document.body.classList.add("live-workspaces-fail-safe");
    delete document.body.dataset.liveWorkspaceActive;
    for (const group of groups) {
      group.element.classList.remove("live-workspace-hidden-pane", "live-workspace-visible-pane");
      group.element.removeAttribute("aria-hidden");
    }
  }

  dispose(groups: RuntimeGroup[]): void {
    this.showAll(groups);
    document.body.classList.remove("live-workspaces-fail-safe");
  }

  get isEnabled(): boolean {
    return this.projectionEnabled;
  }
}
