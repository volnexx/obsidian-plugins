import type { RepositoryDescriptor, RepositoryMetadata } from "../domain/RepositoryDescriptor";
import type { RepositoryId } from "../domain/RepositoryId";
import type { GitBackend } from "../git/GitBackend";
import type { OperationQueue } from "../operations/OperationQueue";
import type { RepositorySafetyFacade } from "../safety/RepositorySafetyFacade";
import type { RepoStore } from "../state/RepoStore";

export interface RepositoryContext<Id extends RepositoryId = RepositoryId> {
  readonly id: Id;
  readonly descriptor: RepositoryDescriptor<Id>;
  readonly backend: GitBackend<Id>;
  readonly store: RepoStore<Id>;
  readonly queue: OperationQueue<Id>;
  readonly safety: RepositorySafetyFacade<Id>;
  readonly metadata: RepositoryMetadata;
}
