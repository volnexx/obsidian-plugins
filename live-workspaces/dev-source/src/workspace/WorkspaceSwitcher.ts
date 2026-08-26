import type { WorkspaceLeaf } from "obsidian";
import type { PaneProjectionResult } from "../layout/PaneVisibility";

export interface SwitchGroupDiagnostic {
  id: string;
  area: "main" | "left" | "right";
  leafIds: string[];
}

export interface WorkspaceSwitchHost {
  getActiveWorkspaceId(): string;
  hasWorkspace(id: string): boolean;
  ensureRuntime(id: string): Promise<void>;
  reconcileNow(): Promise<void>;
  captureWorkspace(id: string): void;
  getOwnedGroupDiagnostics(id: string): SwitchGroupDiagnostic[];
  projectWorkspace(id: string): Promise<PaneProjectionResult>;
  restoreSidebar(id: string): void;
  resolveFocusLeaf(id: string): WorkspaceLeaf | null;
  activateLeaf(leaf: WorkspaceLeaf): void;
  commitActiveWorkspace(id: string): void;
  failSafe(error: unknown): void;
}

export class WorkspaceSwitcher {
  private running = false;
  private pending: { targetId: string; generation: number } | null = null;
  private drainPromise: Promise<void> | null = null;
  private generation = 0;

  constructor(private readonly host: WorkspaceSwitchHost) {}

  switchTo(targetId: string): Promise<void> {
    if (!this.host.hasWorkspace(targetId)) return Promise.reject(new Error(`Unknown workspace: ${targetId}`));
    this.pending = { targetId, generation: ++this.generation };
    if (!this.drainPromise) this.drainPromise = this.drain();
    return this.drainPromise;
  }

  private async drain(): Promise<void> {
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

  private async perform(targetId: string, generation: number): Promise<void> {
    const outgoingId = this.host.getActiveWorkspaceId();
    await this.host.ensureRuntime(targetId);
    if (generation !== this.generation) return;
    await this.host.reconcileNow();
    if (generation !== this.generation) return;

    this.host.captureWorkspace(outgoingId);
    const sourceGroups = this.host.getOwnedGroupDiagnostics(outgoingId);
    const targetGroups = this.host.getOwnedGroupDiagnostics(targetId);
    const projection = await this.host.projectWorkspace(targetId);
    // Projection is the commit boundary. Once CSS visibility has changed we
    // must finish this switch, then process a newer request, otherwise data
    // could still say A while the DOM already shows B.
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
}
