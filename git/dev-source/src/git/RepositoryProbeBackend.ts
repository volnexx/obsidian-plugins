import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryProbeResult, RepositoryProbeTarget } from "../domain/RepositoryProbe";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";

export interface RepositoryProbeBackend<Id extends RepositoryId = RepositoryId> {
  readonly repositoryId: Id;
  readonly target: RepositoryProbeTarget<Id>;
  probe(plan: ValidatedOperationPlan<Id, "probe">): Promise<RepositoryProbeResult<Id>>;
}
