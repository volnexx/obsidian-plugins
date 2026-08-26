import type { CanonicalAbsolutePath } from "../../domain/RepoRelativePath";
import type { OperationId, RepositoryId } from "../../domain/RepositoryId";
import type { BackupPlan } from "../BackupPlan";
import type { VerifiedBackupId } from "../SafetyBackupService";

export interface BackupStorageAllocation {
  readonly backupId: VerifiedBackupId;
  readonly repoId: RepositoryId;
  readonly operationId: OperationId;
  readonly storageRoot: CanonicalAbsolutePath;
  readonly temporaryPath: CanonicalAbsolutePath;
  readonly finalPath: CanonicalAbsolutePath;
  readonly filesystemDevice: bigint;
}

export interface BackupStorageProvider {
  prepare(plan: BackupPlan, backupId: VerifiedBackupId): Promise<BackupStorageAllocation>;
  finalize(allocation: BackupStorageAllocation): Promise<CanonicalAbsolutePath>;
  cleanupPartial(allocation: BackupStorageAllocation): Promise<void>;
}
