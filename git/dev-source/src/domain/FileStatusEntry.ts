import type { RepoRelativePath } from "./RepoRelativePath";

export type GitIndexStatus =
  | "unmodified"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged";

export type GitWorktreeStatus =
  | "unmodified"
  | "modified"
  | "deleted"
  | "type-changed"
  | "unmerged";

export interface IndexStageMetadata {
  readonly objectId: string;
  readonly mode: string;
}

export interface ConflictStages {
  readonly base?: IndexStageMetadata;
  readonly ours?: IndexStageMetadata;
  readonly theirs?: IndexStageMetadata;
}

export interface SubmoduleStatus {
  readonly commitChanged: boolean;
  readonly trackedChanges: boolean;
  readonly untrackedChanges: boolean;
}

export interface FileStatusEntry {
  readonly path: RepoRelativePath;
  readonly originalPath?: RepoRelativePath;
  readonly indexStatus: GitIndexStatus;
  readonly worktreeStatus: GitWorktreeStatus;
  readonly untracked: boolean;
  readonly conflictStages?: ConflictStages;
  readonly changeKind: "ordinary" | "rename" | "copy" | "unmerged" | "untracked";
  readonly similarity?: number;
  readonly submoduleState?: SubmoduleStatus;
}

