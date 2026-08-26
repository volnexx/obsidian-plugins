import type { AuthorizedGitOperation } from "../authorization/OperationAuthorization";
import type { DestructiveOperationKind } from "../domain/OperationTypes";
import type { CanonicalAbsolutePath } from "../domain/RepoRelativePath";
import type { RepositoryId } from "../domain/RepositoryId";
import type { CanonicalPayloadDigest, CanonicalPlanDigest, OperationPlanIdentity, ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";
import type { BackupPlan, BackupPlanDigest, BackupPlanVerifier } from "./BackupPlan";

declare const verifiedBackupIdBrand: unique symbol;
export type VerifiedBackupId = string & { readonly [verifiedBackupIdBrand]: true };
export interface SafetyBackupRequest<Id extends RepositoryId = RepositoryId, Kind extends DestructiveOperationKind = DestructiveOperationKind> { readonly plan: ValidatedOperationPlan<Id, Kind>; }

const backupToken = Symbol("verified-safety-backup-construction");
const backupIssuers = new WeakMap<object, symbol>();

export interface VerifiedSafetyBackupData<Id extends RepositoryId, Kind extends DestructiveOperationKind> {
  readonly backupId: VerifiedBackupId;
  readonly repoId: Id;
  readonly kind: Kind;
  readonly planIdentity: OperationPlanIdentity;
  readonly planDigest: CanonicalPlanDigest;
  readonly payloadDigest: CanonicalPayloadDigest;
  readonly backupPlanDigest: BackupPlanDigest;
  readonly createdAt: number;
  readonly manifestHash: string;
  readonly finalPath: CanonicalAbsolutePath;
}

export class VerifiedSafetyBackup<Id extends RepositoryId = RepositoryId, Kind extends DestructiveOperationKind = DestructiveOperationKind> implements VerifiedSafetyBackupData<Id, Kind> {
  declare private readonly runtimeCapability: typeof backupToken;
  constructor(token: typeof backupToken, readonly backupId: VerifiedBackupId, readonly repoId: Id, readonly kind: Kind, readonly planIdentity: OperationPlanIdentity, readonly planDigest: CanonicalPlanDigest, readonly payloadDigest: CanonicalPayloadDigest, readonly backupPlanDigest: BackupPlanDigest, readonly createdAt: number, readonly manifestHash: string, readonly finalPath: CanonicalAbsolutePath) {
    if (token !== backupToken) throw new TypeError("VerifiedSafetyBackup must be issued by its runtime authority");
    Object.freeze(this);
  }
}

export interface VerifiedSafetyBackupVerifier {
  verify<Id extends RepositoryId, Kind extends DestructiveOperationKind>(candidate: unknown, plan: ValidatedOperationPlan<Id, Kind>): candidate is VerifiedSafetyBackup<Id, Kind>;
}

export class RuntimeVerifiedSafetyBackupAuthority implements VerifiedSafetyBackupVerifier {
  readonly #issuerId = Symbol("verified-safety-backup-issuer");
  constructor(private readonly backupPlanVerifier: BackupPlanVerifier) {}
  issue<Id extends RepositoryId, Kind extends DestructiveOperationKind>(plan: ValidatedOperationPlan<Id, Kind>, backupPlan: BackupPlan<Id, Kind>, data: Omit<VerifiedSafetyBackupData<Id, Kind>, "repoId" | "kind" | "planIdentity" | "planDigest" | "payloadDigest" | "backupPlanDigest">): VerifiedSafetyBackup<Id, Kind> {
    if (!this.backupPlanVerifier.verify(backupPlan, plan)) throw new TypeError("Verified backup requires a genuine matching BackupPlan");
    const backup = new VerifiedSafetyBackup(backupToken, data.backupId, plan.repoId, plan.kind, plan.planIdentity, plan.planDigest, plan.payloadDigest, backupPlan.backupPlanDigest, data.createdAt, data.manifestHash, data.finalPath);
    backupIssuers.set(backup, this.#issuerId);
    return backup;
  }
  verify<Id extends RepositoryId, Kind extends DestructiveOperationKind>(candidate: unknown, plan: ValidatedOperationPlan<Id, Kind>): candidate is VerifiedSafetyBackup<Id, Kind> {
    return candidate instanceof VerifiedSafetyBackup && backupIssuers.get(candidate) === this.#issuerId && candidate.repoId === plan.repoId && candidate.kind === plan.kind && candidate.planIdentity === plan.planIdentity && candidate.planDigest === plan.planDigest && candidate.payloadDigest === plan.payloadDigest;
  }
}

export interface SafetyBackupService {
  createVerified<Id extends RepositoryId, Kind extends DestructiveOperationKind>(request: SafetyBackupRequest<Id, Kind>, operation: AuthorizedGitOperation<Id, Kind>): Promise<VerifiedSafetyBackup<Id, Kind>>;
}
