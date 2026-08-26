import type { DestructiveOperationKind, OperationImpactPlan } from "../domain/OperationTypes";
import type { CanonicalAbsolutePath, RepoRelativePath } from "../domain/RepoRelativePath";
import type { OperationId, RepositoryFamilyId, RepositoryId } from "../domain/RepositoryId";
import type { CanonicalPayloadDigest, CanonicalPlanDigest, OperationPlanIdentity } from "../domain/ValidatedOperationPlan";
import type { BackupPlanDigest, BackupRequirement } from "./BackupPlan";
import type { VerifiedBackupId } from "./SafetyBackupService";

export const BACKUP_MANIFEST_SCHEMA_VERSION = 1 as const;
export type BackupArtifactBase = "worktree" | "git-dir" | "common-dir";
export type BackupFileKind = "regular" | "symlink" | "directory";

export interface BackupFileSnapshot {
  readonly base: BackupArtifactBase;
  readonly sourcePath: RepoRelativePath;
  readonly state: "present" | "absent";
  readonly kind: BackupFileKind | null;
  readonly artifactPath: string | null;
  readonly mode: number | null;
  readonly size: number;
  readonly mtimeMs: number | null;
  readonly sha256: string | null;
  readonly symlinkTarget: string | null;
}

export interface BackupRefState {
  readonly headRaw: string | null;
  readonly headObjectId: string | null;
  readonly refs: readonly { readonly name: string; readonly objectId: string | null; readonly symbolicTarget: string | null }[];
}

export interface BackupManifestParticipant {
  readonly repoId: RepositoryId;
  readonly familyId: RepositoryFamilyId;
  readonly canonicalRoot: CanonicalAbsolutePath;
  readonly gitDir: CanonicalAbsolutePath;
  readonly commonDir: CanonicalAbsolutePath;
  readonly objectFormat: "sha1" | "sha256";
  readonly impact: OperationImpactPlan;
  readonly requirements: BackupRequirement;
  readonly preflightIdentity: string;
  readonly postflightIdentity: string;
  readonly files: readonly BackupFileSnapshot[];
  readonly refs: BackupRefState;
}

export interface BackupManifest {
  readonly schemaVersion: typeof BACKUP_MANIFEST_SCHEMA_VERSION;
  readonly backupId: VerifiedBackupId;
  readonly createdAt: number;
  readonly repoId: RepositoryId;
  readonly operationId: OperationId;
  readonly operationKind: DestructiveOperationKind;
  readonly planIdentity: OperationPlanIdentity;
  readonly planDigest: CanonicalPlanDigest;
  readonly payloadDigest: CanonicalPayloadDigest;
  readonly backupPlanDigest: BackupPlanDigest;
  readonly repositoryIds: readonly RepositoryId[];
  readonly familyIds: readonly RepositoryFamilyId[];
  readonly participants: readonly BackupManifestParticipant[];
  readonly verification: {
    readonly state: "verified";
    readonly algorithm: "sha256";
    readonly artifactCount: number;
  };
}
