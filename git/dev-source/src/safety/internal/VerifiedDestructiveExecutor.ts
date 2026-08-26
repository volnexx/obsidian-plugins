import type { AuthorizedGitOperation } from "../../authorization/OperationAuthorization";
import type { DestructiveOperationKind } from "../../domain/OperationTypes";
import type { OperationId, RepositoryId } from "../../domain/RepositoryId";
import type { CanonicalPayloadDigest, CanonicalPlanDigest, OperationPlanIdentity, ValidatedOperationPlanVerifier } from "../../domain/ValidatedOperationPlan";
import type { VerifiedBackupId, VerifiedSafetyBackup, VerifiedSafetyBackupVerifier } from "../SafetyBackupService";

const destructivePermitToken = Symbol("verified-destructive-permit-construction");
const destructivePermitIssuers = new WeakMap<object, symbol>();

export class VerifiedDestructivePermit<Id extends RepositoryId = RepositoryId, Kind extends DestructiveOperationKind = DestructiveOperationKind> {
  declare private readonly runtimeCapability: typeof destructivePermitToken;
  constructor(token: typeof destructivePermitToken, readonly repoId: Id, readonly operationId: OperationId, readonly kind: Kind, readonly planIdentity: OperationPlanIdentity, readonly planDigest: CanonicalPlanDigest, readonly payloadDigest: CanonicalPayloadDigest, readonly backupId: VerifiedBackupId) {
    if (token !== destructivePermitToken) throw new TypeError("VerifiedDestructivePermit must be issued by its runtime authority");
    Object.freeze(this);
  }
}

export class RuntimeVerifiedDestructivePermitAuthority {
  readonly #issuerId = Symbol("verified-destructive-permit-issuer");
  constructor(private readonly planVerifier: ValidatedOperationPlanVerifier, private readonly backupVerifier: VerifiedSafetyBackupVerifier) {}
  issue<Id extends RepositoryId, Kind extends DestructiveOperationKind>(operation: AuthorizedGitOperation<Id, Kind>, backup: VerifiedSafetyBackup<Id, Kind>): VerifiedDestructivePermit<Id, Kind> {
    const plan = operation.plan;
    if (!this.planVerifier.verify(plan) || !this.backupVerifier.verify(backup, plan)) throw new TypeError("Destructive permit evidence does not match the authorized plan");
    const permit = new VerifiedDestructivePermit(destructivePermitToken, plan.repoId, plan.operationId, plan.kind, plan.planIdentity, plan.planDigest, plan.payloadDigest, backup.backupId);
    destructivePermitIssuers.set(permit, this.#issuerId);
    return permit;
  }
  verify<Id extends RepositoryId, Kind extends DestructiveOperationKind>(candidate: unknown, operation: AuthorizedGitOperation<Id, Kind>): candidate is VerifiedDestructivePermit<Id, Kind> {
    const plan = operation.plan;
    return candidate instanceof VerifiedDestructivePermit && destructivePermitIssuers.get(candidate) === this.#issuerId && candidate.repoId === plan.repoId && candidate.operationId === plan.operationId && candidate.kind === plan.kind && candidate.planIdentity === plan.planIdentity && candidate.planDigest === plan.planDigest && candidate.payloadDigest === plan.payloadDigest;
  }
}

/** Runtime implementation must verify both authorized-operation and destructive-permit provenance. */
export interface VerifiedDestructiveExecutor {
  execute<Id extends RepositoryId, Kind extends DestructiveOperationKind>(operation: AuthorizedGitOperation<Id, Kind>, permit: VerifiedDestructivePermit<Id, Kind>): Promise<void>;
}
