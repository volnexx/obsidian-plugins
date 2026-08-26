import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryWatcher, RepositoryWatchEvent } from "./RepositoryWatcher";

export type RepositoryInvalidationReason =
  | "worktree-changed"
  | "index-changed"
  | "refs-changed"
  | "shared-common-dir-changed"
  | "operation-state-changed"
  | "topology-changed"
  | "watch-overflow"
  | "repository-missing"
  | "repository-returned";

export interface TargetedRepositoryInvalidation<Id extends RepositoryId = RepositoryId> {
  readonly repoId: Id;
  readonly reason: RepositoryInvalidationReason;
  readonly generation: number;
}

export interface RepositoryWatchCoordinator {
  attach<Id extends RepositoryId>(watcher: RepositoryWatcher<Id>): Promise<void>;
  accept<Id extends RepositoryId>(event: RepositoryWatchEvent<Id>): void;
  subscribe(listener: (invalidation: TargetedRepositoryInvalidation) => void): () => void;
  detach(repoId: RepositoryId): Promise<void>;
}
