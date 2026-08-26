import type { RepositoryBoundaryPermit } from "../authorization/OperationAuthorization";
import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";

export type { RepositoryBoundaryPermit } from "../authorization/OperationAuthorization";
export type RepositoryBoundaryDecision =
  | { readonly allowed: true; readonly permit: RepositoryBoundaryPermit }
  | { readonly allowed: false; readonly code: "cross-context-boundary" | "impact-unknown" | "relation-mismatch" | "remote-target-unresolved"; readonly reason: string };

/** Authorizes the complete validated participant/family impact set as one indivisible plan. */
export interface RepositoryBoundaryPolicy {
  authorize<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>): RepositoryBoundaryDecision;
}
