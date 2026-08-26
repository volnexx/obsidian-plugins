import type { RepositoryDescriptor } from "../domain/RepositoryDescriptor";
import type { RepositoryId } from "../domain/RepositoryId";

export type RepositoryWatchCategory =
  | "worktree"
  | "index"
  | "refs"
  | "shared-common-dir"
  | "operation-state"
  | "topology";

export interface RepositoryWatchEvent<Id extends RepositoryId = RepositoryId> {
  readonly repoId: Id;
  readonly category: RepositoryWatchCategory;
  readonly observedAt: number;
  readonly overflow: boolean;
}

export interface RepositoryWatcher<Id extends RepositoryId = RepositoryId> {
  readonly repositoryId: Id;
  start(
    descriptor: RepositoryDescriptor<Id>,
    listener: (event: RepositoryWatchEvent<Id>) => void
  ): Promise<void>;
  stop(repoId: Id): Promise<void>;
}
