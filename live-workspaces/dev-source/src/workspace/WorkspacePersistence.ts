import type { Plugin } from "obsidian";
import { DATA_SCHEMA_VERSION, type LiveWorkspacesData } from "../types/workspace";

const SAVE_DEBOUNCE_MS = 400;

export class WorkspacePersistence {
  private timer: number | null = null;
  private pending: LiveWorkspacesData | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<LiveWorkspacesData | null> {
    const raw = (await this.plugin.loadData()) as unknown;
    if (!this.isValid(raw)) return null;
    return raw;
  }

  schedule(data: LiveWorkspacesData): void {
    this.pending = structuredClone(data);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const data = this.pending;
    this.pending = null;
    if (!data) return this.writeQueue;
    this.writeQueue = this.writeQueue.then(() => this.plugin.saveData(data));
    await this.writeQueue;
    if (this.pending) await this.flush();
  }

  private isValid(value: unknown): value is LiveWorkspacesData {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<LiveWorkspacesData>;
    return (
      candidate.schemaVersion === DATA_SCHEMA_VERSION &&
      typeof candidate.activeWorkspaceId === "string" &&
      Array.isArray(candidate.workspaces)
    );
  }
}
