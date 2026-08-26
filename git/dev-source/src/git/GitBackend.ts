import type { AuthorizedGitOperation } from "../authorization/OperationAuthorization";
import type { RepositoryDescriptor } from "../domain/RepositoryDescriptor";
import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryObservation } from "../domain/RepositorySnapshot";

/** Exact reviewed stage-2 read-only surface. It is intentionally expanded only stage by stage. */
export interface GitBackend<Id extends RepositoryId = RepositoryId> {
  readonly repositoryId: Id;
  readonly descriptor: RepositoryDescriptor<Id>;

  status(operation: AuthorizedGitOperation<Id, "status">): Promise<RepositoryObservation<Id>>;
}
