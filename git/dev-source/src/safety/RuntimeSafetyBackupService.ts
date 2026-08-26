import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

import type { AuthorizedGitOperation, AuthorizedGitOperationVerifier } from "../authorization/OperationAuthorization";
import type { DestructiveOperationKind } from "../domain/OperationTypes";
import type { RepositoryId } from "../domain/RepositoryId";
import type { BackupManifest, BackupManifestParticipant } from "./BackupManifest";
import { BACKUP_MANIFEST_SCHEMA_VERSION } from "./BackupManifest";
import { BackupError } from "./BackupErrors";
import type { BackupPlan } from "./BackupPlan";
import type { RuntimeBackupPlanAuthority } from "./BackupPlan";
import type { SafetyBackupRequest, VerifiedBackupId, VerifiedSafetyBackup } from "./SafetyBackupService";
import type { RuntimeVerifiedSafetyBackupAuthority } from "./SafetyBackupService";
import type { BackupSnapshotEngine } from "./snapshot/BackupSnapshotEngine";
import type { BackupStorageAllocation, BackupStorageProvider } from "./storage/BackupStorageProvider";
import type { SafetyFileSystem } from "./storage/SafetyFileSystem";
import { NodeSafetyFileSystem } from "./storage/SafetyFileSystem";

const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const immutable = <Value>(value: Value): Value => {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const key of Reflect.ownKeys(item)) freeze(Reflect.get(item, key));
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
};

export interface BackupTransactionHooks {
  afterPreflightVerified?(plan: BackupPlan): Promise<void> | void;
  afterParticipantCaptured?(plan: BackupPlan, participantIndex: number, allocation: BackupStorageAllocation): Promise<void> | void;
  afterManifestWritten?(plan: BackupPlan, allocation: BackupStorageAllocation): Promise<void> | void;
  beforeFinalize?(plan: BackupPlan, allocation: BackupStorageAllocation): Promise<void> | void;
  afterFinalize?(plan: BackupPlan, finalPath: string): Promise<void> | void;
}

export class RuntimeSafetyBackupService {
  constructor(
    private readonly backupPlanAuthority: RuntimeBackupPlanAuthority,
    private readonly storage: BackupStorageProvider,
    private readonly snapshotEngine: BackupSnapshotEngine,
    private readonly backupAuthority: RuntimeVerifiedSafetyBackupAuthority,
    private readonly authorizedVerifier: AuthorizedGitOperationVerifier,
    private readonly fs: SafetyFileSystem = new NodeSafetyFileSystem(),
    private readonly hooks: BackupTransactionHooks = {},
    private readonly idFactory: () => VerifiedBackupId = () => randomUUID() as VerifiedBackupId,
    private readonly clock: () => number = Date.now
  ) {}

  async createVerified<Id extends RepositoryId, Kind extends DestructiveOperationKind>(request: SafetyBackupRequest<Id, Kind>, operation: AuthorizedGitOperation<Id, Kind>): Promise<VerifiedSafetyBackup<Id, Kind>> {
    this.#verifyAuthorized(request.plan.repoId, request.plan.kind, operation, request.plan);
    const backupPlan = await this.backupPlanAuthority.derive(request.plan);
    return this.createFromBackupPlan(backupPlan, operation);
  }

  /** Public for deterministic stale-plan tests; still requires the exact authorized envelope. */
  async createFromBackupPlan<Id extends RepositoryId, Kind extends DestructiveOperationKind>(backupPlan: BackupPlan<Id, Kind>, operation: AuthorizedGitOperation<Id, Kind>): Promise<VerifiedSafetyBackup<Id, Kind>> {
    const plan = backupPlan.sourcePlan;
    if (!this.backupPlanAuthority.verify(backupPlan, plan)) throw new BackupError("invalid-plan", "BackupPlan provenance or integrity verification failed", plan.repoId, plan.operationId);
    this.#verifyAuthorized(plan.repoId, plan.kind, operation, plan);
    this.#assertActive(backupPlan);
    const backupId = this.idFactory();
    let allocation: BackupStorageAllocation | null = null;
    let finalized = false;
    try {
      allocation = await this.storage.prepare(backupPlan, backupId);
      for (const participant of backupPlan.participants) {
        const current = await this.snapshotEngine.inspect({
          repositoryId: participant.repoId, familyId: participant.familyId, name: participant.repoId,
          locator: { kind: "external", locatorId: participant.repoId, lastKnownAbsolutePath: participant.runtimeRoot }, runtimeRoot: participant.runtimeRoot,
          displayPath: participant.runtimeRoot, gitDir: participant.gitDir, commonDir: participant.commonDir,
          superprojectRoot: null, objectFormat: participant.objectFormat, aliases: []
        }, participant.requirements, plan.signal, plan.deadlineAt);
        if (current.digest !== participant.preflightIdentity) throw new BackupError("stale-backup-plan", "Protected state differs from the validated backup preflight", plan.repoId, plan.operationId);
      }
      await this.hooks.afterPreflightVerified?.(backupPlan);
      const participants: BackupManifestParticipant[] = [];
      let artifactCount = 0;
      for (const [index, participant] of backupPlan.participants.entries()) {
        const captured = await this.snapshotEngine.capture(participant, allocation.temporaryPath, index, plan.signal, plan.deadlineAt);
        participants.push(captured.manifestParticipant);
        artifactCount += captured.artifactCount;
        await this.hooks.afterParticipantCaptured?.(backupPlan, index, allocation);
      }
      const manifest = immutable<BackupManifest>({
        schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
        backupId,
        createdAt: this.clock(),
        repoId: plan.repoId,
        operationId: plan.operationId,
        operationKind: plan.kind,
        planIdentity: plan.planIdentity,
        planDigest: plan.planDigest,
        payloadDigest: plan.payloadDigest,
        backupPlanDigest: backupPlan.backupPlanDigest,
        repositoryIds: [...backupPlan.repositoryIds],
        familyIds: [...backupPlan.familyIds],
        participants,
        verification: { state: "verified", algorithm: "sha256", artifactCount }
      });
      const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
      const manifestPath = join(allocation.temporaryPath, "manifest.json");
      await this.fs.writeFile(manifestPath, manifestBytes, { flag: "wx", mode: 0o400 });
      await this.hooks.afterManifestWritten?.(backupPlan, allocation);
      const manifestHash = await this.#verifySnapshot(allocation.temporaryPath, backupPlan, manifestBytes);
      await this.hooks.beforeFinalize?.(backupPlan, allocation);
      this.#verifyAuthorized(plan.repoId, plan.kind, operation, plan);
      const finalPath = await this.storage.finalize(allocation);
      finalized = true;
      await this.hooks.afterFinalize?.(backupPlan, finalPath);
      const finalBytes = await this.fs.readFile(join(finalPath, "manifest.json"));
      if (sha256(finalBytes) !== manifestHash) throw new BackupError("verification-failed", "Final manifest differs from verified temporary manifest", plan.repoId, plan.operationId);
      await this.#verifySnapshot(finalPath, backupPlan, finalBytes);
      this.#verifyAuthorized(plan.repoId, plan.kind, operation, plan);
      return this.backupAuthority.issue(plan, backupPlan, { backupId, createdAt: manifest.createdAt, manifestHash, finalPath });
    } catch (error) {
      if (allocation !== null && !finalized) await this.storage.cleanupPartial(allocation);
      if (error instanceof BackupError) throw error;
      throw new BackupError("snapshot-failed", "Safety backup transaction failed", plan.repoId, plan.operationId, { cause: error });
    }
  }

  async #verifySnapshot(root: string, plan: BackupPlan, expectedBytes: Buffer): Promise<string> {
    const actualBytes = await this.fs.readFile(join(root, "manifest.json"));
    if (!actualBytes.equals(expectedBytes)) throw new BackupError("manifest-corrupt", "Backup manifest changed during transaction", plan.repoId, plan.sourcePlan.operationId);
    let manifest: BackupManifest;
    try { manifest = JSON.parse(actualBytes.toString("utf8")) as BackupManifest; }
    catch (error) { throw new BackupError("manifest-corrupt", "Backup manifest is not valid JSON", plan.repoId, plan.sourcePlan.operationId, { cause: error }); }
    if (manifest.planIdentity !== plan.planIdentity || manifest.planDigest !== plan.planDigest || manifest.payloadDigest !== plan.payloadDigest || manifest.backupPlanDigest !== plan.backupPlanDigest || manifest.repoId !== plan.repoId || manifest.operationKind !== plan.kind) {
      throw new BackupError("manifest-corrupt", "Backup manifest binding is invalid", plan.repoId, plan.sourcePlan.operationId);
    }
    for (const participant of manifest.participants) await this.snapshotEngine.verifyArtifacts(root, participant);
    return sha256(actualBytes);
  }

  #verifyAuthorized<Id extends RepositoryId, Kind extends DestructiveOperationKind>(repoId: Id, kind: Kind, operation: AuthorizedGitOperation<Id, Kind>, plan: BackupPlan<Id, Kind>["sourcePlan"]): void {
    if (!this.authorizedVerifier.verifyFor(operation, repoId, kind) || operation.plan !== plan) throw new BackupError("invalid-plan", "Active authorization does not match the destructive plan", repoId, plan.operationId);
  }

  #assertActive(plan: BackupPlan): void {
    if (plan.signal.aborted) throw new BackupError("cancelled", "Backup was cancelled before storage allocation", plan.repoId, plan.sourcePlan.operationId);
    if (this.clock() > plan.deadlineAt) throw new BackupError("timeout", "Backup deadline elapsed before storage allocation", plan.repoId, plan.sourcePlan.operationId);
  }
}
