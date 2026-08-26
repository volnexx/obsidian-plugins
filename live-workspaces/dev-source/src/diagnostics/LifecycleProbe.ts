import type { App, WorkspaceLeaf } from "obsidian";
import type { IdentitySnapshot, LifecycleProbeResult, RuntimeGroup } from "../types/workspace";
import { getLeafId } from "../utils/leaf";

interface ProbeHost {
  getActiveWorkspaceId(): string;
  getNextWorkspaceId(): string | null;
  switchTo(id: string): Promise<void>;
  getRuntimeGroups(): RuntimeGroup[];
}

interface ViewWithClose {
  onClose?: () => Promise<void> | void;
  getViewType(): string;
}

export class LifecycleProbe {
  constructor(private readonly app: App, private readonly host: ProbeHost) {}

  async runRoundTrip(): Promise<LifecycleProbeResult> {
    const originalId = this.host.getActiveWorkspaceId();
    const targetId = this.host.getNextWorkspaceId();
    if (!targetId || targetId === originalId) throw new Error("Create at least two workspaces before running the probe");

    const before = this.snapshot();
    const closeCalls: LifecycleProbeResult["onCloseCalls"] = [];
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

  snapshot(): Map<string, IdentitySnapshot> {
    const result = new Map<string, IdentitySnapshot>();
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

  private instrumentOnClose(closeCalls: LifecycleProbeResult["onCloseCalls"]): () => void {
    const restorers: Array<() => void> = [];
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const view = leaf.view as unknown as ViewWithClose;
      if (typeof view.onClose !== "function") return;
      const original = view.onClose;
      const leafId = getLeafId(leaf);
      const viewType = view.getViewType();
      view.onClose = function (): Promise<void> | void {
        closeCalls.push({ leafId, viewType });
        return original.call(this);
      };
      restorers.push(() => {
        if (view.onClose !== original) view.onClose = original;
      });
    });
    return () => restorers.reverse().forEach((restore) => restore());
  }

  private compare(
    before: Map<string, IdentitySnapshot>,
    after: Map<string, IdentitySnapshot>,
    onCloseCalls: LifecycleProbeResult["onCloseCalls"],
    expectedWorkspaceId: string
  ): LifecycleProbeResult {
    let leafIdentityPreserved = true;
    let viewIdentityPreserved = true;
    let groupIdentityPreserved = true;
    let sizesRestored = true;
    const changedViews: LifecycleProbeResult["changedViews"] = [];
    const notes: string[] = [];

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
    const passed =
      leafIdentityPreserved &&
      viewIdentityPreserved &&
      groupIdentityPreserved &&
      focusRestored &&
      sizesRestored &&
      onCloseCalls.length === 0;
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
}
