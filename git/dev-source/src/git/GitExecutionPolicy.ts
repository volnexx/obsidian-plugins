import type { GitExecutionPermit } from "../authorization/OperationAuthorization";
import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";

export type { GitExecutionPermit, GitExecutionProfile, GitExecutionSurface } from "../authorization/OperationAuthorization";
export type GitExecutionPolicyDecision =
  | { readonly allowed: true; readonly permit: GitExecutionPermit }
  | { readonly allowed: false; readonly code: "trust-required" | "execution-surface-denied" | "plan-invalid"; readonly reason: string };

/** Trust and execution surfaces are derived internally; the caller cannot declare them. */
export interface GitExecutionPolicy {
  authorize<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>): GitExecutionPolicyDecision;
}
