import type { GitExecutionSurface, RuntimeGitExecutionPermitAuthority } from "../../authorization/OperationAuthorization";
import { hasMutationEffects } from "../../domain/OperationTypes";
import type { OperationKind } from "../../domain/OperationRequests";
import type { RepositoryId } from "../../domain/RepositoryId";
import type { RepositoryTrust } from "../../domain/RepositoryTrust";
import type { ValidatedOperationPlan, ValidatedOperationPlanVerifier } from "../../domain/ValidatedOperationPlan";
import type { GitExecutionPolicy, GitExecutionPolicyDecision } from "../GitExecutionPolicy";

const DISABLED_READ_SURFACES: readonly GitExecutionSurface[] = Object.freeze(["hooks", "hooks-path", "fsmonitor", "credential-helper", "ssh-command", "filter", "merge-driver", "external-diff", "textconv", "editor", "pager", "unknown"]);

export class ReadOnlyGitExecutionPolicy implements GitExecutionPolicy {
  constructor(private readonly planVerifier: ValidatedOperationPlanVerifier, private readonly trustFor: (repoId: RepositoryId) => RepositoryTrust, readonly permitAuthority: RuntimeGitExecutionPermitAuthority) {}

  authorize<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>): GitExecutionPolicyDecision {
    if (!this.planVerifier.verify(plan)) return { allowed: false, code: "plan-invalid", reason: "Plan provenance is invalid" };
    if (plan.effects.network || hasMutationEffects(plan.effects)) return { allowed: false, code: "execution-surface-denied", reason: "Stage 2 execution policy permits local read-only Git only" };
    return { allowed: true, permit: this.permitAuthority.issue(plan, { trust: this.trustFor(plan.repoId), allowNetwork: false, allowMutation: false, allowRepositoryDefinedCode: false, disabledSurfaces: DISABLED_READ_SURFACES }) };
  }
}
