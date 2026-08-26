/** Public API exposed by the Obsidian plugin whose manifest id is `activity`. */
export interface ActivityRange {
  /** Inclusive local date in YYYY-MM-DD format. */
  from?: string;
  /** Inclusive local date in YYYY-MM-DD format. */
  to?: string;
}

export interface ActivityNoteSnapshot {
  path: string;
  activeMs: number;
  openCount: number;
  firstOpenedAt: number | null;
  lastOpenedAt: number | null;
  lastActiveAt: number | null;
}

export interface ActivitySnapshot {
  apiVersion: 1;
  generatedAt: number;
  from: string | null;
  to: string | null;
  totalActiveMs: number;
  totalOpenCount: number;
  notes: ActivityNoteSnapshot[];
}

export interface ActivityChange {
  type: "tick" | "open" | "rename" | "settings" | "ready";
  at: number;
  path?: string;
  previousPath?: string;
}

export interface ActivityApi {
  readonly apiVersion: 1;
  getSnapshot(range?: ActivityRange): ActivitySnapshot;
  getDailyStats(date?: string): ActivitySnapshot;
  getNoteStats(path: string, range?: ActivityRange): ActivityNoteSnapshot | null;
  getAllNoteStats(range?: ActivityRange): ActivityNoteSnapshot[];
  getTotalActiveMs(range?: ActivityRange): number;
  getNoteActiveMs(path: string, range?: ActivityRange): number;
  getOpenCount(path: string, range?: ActivityRange): number;
  getTopNotes(options?: {
    metric?: "activeMs" | "openCount";
    limit?: number;
    from?: string;
    to?: string;
  }): ActivityNoteSnapshot[];
  getCurrentActivity(): {
    active: boolean;
    notePath: string | null;
    idleMs: number;
    appVisible: boolean;
    windowFocused: boolean;
  };
  subscribe(listener: (change: Readonly<ActivityChange>) => void): () => void;
  flush(): Promise<void>;
}

export interface ActivityPluginInstance {
  api?: ActivityApi;
}

/**
 * Usage from another plugin:
 *
 * const activity = (this.app as any).plugins.plugins["activity"] as ActivityPluginInstance | undefined;
 * const api = activity?.api;
 * const top = api?.getTopNotes({ metric: "openCount", limit: 6 });
 * const unsubscribe = api?.subscribe((change) => console.log(change));
 *
 * If Activity loads later, listen once through the Workspace event emitter:
 * (this.app.workspace as any).on("activity:ready", (readyApi: ActivityApi) => { ... });
 */
