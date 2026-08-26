import type { OperationId, RepositoryId } from "../domain/RepositoryId";

export type BackupErrorCode =
  | "invalid-plan"
  | "stale-backup-plan"
  | "storage-unavailable"
  | "storage-not-isolated"
  | "path-escape"
  | "snapshot-failed"
  | "verification-failed"
  | "manifest-corrupt"
  | "finalize-failed"
  | "cancelled"
  | "timeout";

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message: string, readonly repositoryId: RepositoryId, readonly operationId: OperationId, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupError";
  }
}
