import type { RuntimeRepositoryBoundaryPermitAuthority } from "../authorization/OperationAuthorization";
import { hasMutationEffects } from "../domain/OperationTypes";
import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan, ValidatedOperationPlanVerifier } from "../domain/ValidatedOperationPlan";
import type { RepositoryBoundaryDecision, RepositoryBoundaryPolicy } from "./RepositoryBoundaryPolicy";

export class ReadOnlyRepositoryBoundaryPolicy implements RepositoryBoundaryPolicy {
  constructor(private readonly planVerifier: ValidatedOperationPlanVerifier, readonly permitAuthority: RuntimeRepositoryBoundaryPermitAuthority) {}

  authorize<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>): RepositoryBoundaryDecision {
    if (!this.planVerifier.verify(plan)) return { allowed: false, code: "relation-mismatch", reason: "Plan provenance or relation locks are invalid" };
    if (hasMutationEffects(plan.effects)) return { allowed: false, code: "cross-context-boundary", reason: "Stage 2 permits read-only plans only" };
    return { allowed: true, permit: this.permitAuthority.issue(plan) };
  }
}
