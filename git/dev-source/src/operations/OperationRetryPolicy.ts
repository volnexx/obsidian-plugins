import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";

export type OperationRetryDecision =
  | { readonly retry: false; readonly reason: string }
  | { readonly retry: true; readonly delayMs: number; readonly requiresFreshObservation: true };

export interface OperationRetryPolicy {
  decide<Id extends RepositoryId, Kind extends OperationKind>(
    plan: ValidatedOperationPlan<Id, Kind>,
    attempt: number
  ): OperationRetryDecision;
}
