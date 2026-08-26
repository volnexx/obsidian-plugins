export type { FileStatusEntry } from "../../domain/FileStatusEntry";
export type { RepositoryId } from "../../domain/RepositoryId";
export type { BranchState, RepositoryObservation } from "../../domain/RepositorySnapshot";

export interface RepositoryDiagnosticReadModel {
  readonly repositoryId: string;
  readonly displayPath: string;
  readonly rootPath: string;
  readonly branch: string;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly conflicts: number;
  readonly lifecycle: "ready" | "missing" | "disposing" | "disposed";
  readonly error: string | null;
}

export interface RepositoryRefreshResult {
  readonly repositoryId: string;
  readonly ok: boolean;
  readonly error: string | null;
}
