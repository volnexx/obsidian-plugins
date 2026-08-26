import type { VerifiedBackupId } from "./SafetyBackupService";

export interface BackupRetentionCandidate {
  readonly backupId: VerifiedBackupId;
  readonly verified: boolean;
  readonly active: boolean;
  readonly createdAt: number;
}

/** Retention runs outside destructive critical paths and may never select the last verified backup. */
export interface BackupRetentionPolicy {
  selectForCleanup(candidates: readonly BackupRetentionCandidate[]): readonly VerifiedBackupId[];
}

export class KeepVerifiedBackupRetentionPolicy implements BackupRetentionPolicy {
  selectForCleanup(candidates: readonly BackupRetentionCandidate[]): readonly VerifiedBackupId[] {
    const verified = candidates.filter((candidate) => candidate.verified);
    if (verified.length <= 1) return [];
    const newestVerified = [...verified].sort((left, right) => right.createdAt - left.createdAt)[0];
    return Object.freeze(candidates.filter((candidate) => candidate.verified && !candidate.active && candidate.backupId !== newestVerified?.backupId).map((candidate) => candidate.backupId));
  }
}
