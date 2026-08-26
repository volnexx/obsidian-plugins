import type { OperationKind } from "../domain/OperationRequests";
import type { OperationIntent } from "../domain/OperationTypes";
import type { RepositoryId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";

/** Sole trusted authority for deriving effects, impacts, participants, required family locks and immutable plan digests. */
export interface OperationPlanner {
  plan<Id extends RepositoryId, Kind extends OperationKind>(intent: OperationIntent<Id, Kind>): Promise<ValidatedOperationPlan<Id, Kind>>;
}
