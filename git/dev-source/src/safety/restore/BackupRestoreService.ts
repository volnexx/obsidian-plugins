import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import type { AuthorizedGitOperation, AuthorizedGitOperationVerifier } from "../../authorization/OperationAuthorization";
import type { DestructiveOperationKind } from "../../domain/OperationTypes";
import type { RepositoryDescriptor } from "../../domain/RepositoryDescriptor";
import type { RepositoryId } from "../../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../../domain/ValidatedOperationPlan";
import type { BackupFileSnapshot, BackupManifest, BackupManifestParticipant } from "../BackupManifest";
import { BackupError } from "../BackupErrors";
import type { RepositoryDescriptorCatalog } from "../BackupPlan";
import type { VerifiedSafetyBackup, VerifiedSafetyBackupVerifier } from "../SafetyBackupService";
import type { BackupSnapshotEngine } from "../snapshot/BackupSnapshotEngine";
import type { SafetyFileSystem } from "../storage/SafetyFileSystem";
import { NodeSafetyFileSystem } from "../storage/SafetyFileSystem";

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";
const assertSafeRelative = (value: string): string => {
  const normalized = value.split("\\").join("/");
  if (normalized.length === 0 || normalized.includes("\0") || isAbsolute(value) || normalized.startsWith("/") || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) throw new TypeError("Unsafe restore path");
  return normalized;
};
const joinContained = (base: string, path: string): string => {
  const safe = assertSafeRelative(path);
  const target = join(base, ...safe.split("/"));
  const rel = relative(base, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new TypeError("Restore target escaped base");
  return target;
};

/** Verifies every artifact before changing protected state, then restores with filesystem primitives only. */
export class BackupRestoreService {
  constructor(
    private readonly backupVerifier: VerifiedSafetyBackupVerifier,
    private readonly authorizationVerifier: AuthorizedGitOperationVerifier,
    private readonly catalog: RepositoryDescriptorCatalog,
    private readonly snapshotEngine: BackupSnapshotEngine,
    private readonly fs: SafetyFileSystem = new NodeSafetyFileSystem()
  ) {}

  async restore<Id extends RepositoryId, Kind extends DestructiveOperationKind>(backup: VerifiedSafetyBackup<Id, Kind>, plan: ValidatedOperationPlan<Id, Kind>, operation: AuthorizedGitOperation<Id, Kind>): Promise<void> {
    if (!this.backupVerifier.verify(backup, plan) || !this.authorizationVerifier.verifyFor(operation, plan.repoId, plan.kind) || operation.plan !== plan) throw new BackupError("invalid-plan", "Restore requires matching verified backup and active authorization", plan.repoId, plan.operationId);
    const manifestPath = join(backup.finalPath, "manifest.json");
    const bytes = await this.fs.readFile(manifestPath);
    if (sha256(bytes) !== backup.manifestHash) throw new BackupError("manifest-corrupt", "Final backup manifest hash mismatch", plan.repoId, plan.operationId);
    let manifest: BackupManifest;
    try { manifest = JSON.parse(bytes.toString("utf8")) as BackupManifest; }
    catch (error) { throw new BackupError("manifest-corrupt", "Final backup manifest is invalid", plan.repoId, plan.operationId, { cause: error }); }
    if (manifest.backupId !== backup.backupId || manifest.planIdentity !== plan.planIdentity || manifest.planDigest !== plan.planDigest || manifest.payloadDigest !== plan.payloadDigest || manifest.backupPlanDigest !== backup.backupPlanDigest || manifest.operationKind !== plan.kind) throw new BackupError("manifest-corrupt", "Final backup manifest binding mismatch", plan.repoId, plan.operationId);
    for (const participant of manifest.participants) await this.snapshotEngine.verifyArtifacts(backup.finalPath, participant);
    // Only after all participants are verified may any participant be changed.
    for (const participant of manifest.participants) await this.#restoreParticipant(backup.finalPath, participant, plan);
  }

  async #restoreParticipant(snapshotRoot: string, participant: BackupManifestParticipant, plan: ValidatedOperationPlan): Promise<void> {
    const descriptor = this.catalog.get(participant.repoId);
    if (descriptor?.runtimeRoot !== participant.canonicalRoot || descriptor.gitDir !== participant.gitDir || descriptor.commonDir !== participant.commonDir || descriptor.familyId !== participant.familyId) throw new BackupError("invalid-plan", "Repository descriptor no longer matches backup manifest", plan.repoId, plan.operationId);
    const worktreeRoots = participant.requirements.worktree === "entire-worktree" ? await this.#worktreeTopLevel(descriptor) : participant.requirements.worktreePaths;
    for (const path of worktreeRoots) await this.#removeContained(descriptor.runtimeRoot, path);
    const removalRoots = new Set<string>();
    if (participant.requirements.index === "full-index") removalRoots.add("git-dir:index");
    if (participant.requirements.refs === "all-local-refs") { removalRoots.add("common-dir:refs"); removalRoots.add("common-dir:packed-refs"); }
    if (participant.requirements.gitObjects) removalRoots.add("common-dir:objects");
    if (participant.requirements.gitConfig) { removalRoots.add("common-dir:config"); removalRoots.add("git-dir:config.worktree"); }
    for (const root of removalRoots) {
      const separator = root.indexOf(":");
      const baseName = root.slice(0, separator) as BackupFileSnapshot["base"];
      const path = root.slice(separator + 1);
      await this.#removeContained(this.#base(descriptor, baseName), path);
    }
    const sorted = [...participant.files].sort((left, right) => {
      const depth = (value: BackupFileSnapshot): number => value.sourcePath.split("/").length;
      if (left.kind === "directory" && right.kind !== "directory") return -1;
      if (right.kind === "directory" && left.kind !== "directory") return 1;
      return depth(left) - depth(right);
    });
    for (const file of sorted) await this.#restoreEntry(snapshotRoot, descriptor, file);
  }

  async #restoreEntry(snapshotRoot: string, descriptor: RepositoryDescriptor, file: BackupFileSnapshot): Promise<void> {
    const base = this.#base(descriptor, file.base);
    const target = joinContained(base, file.sourcePath);
    await this.#assertNoSymlinkParent(base, file.sourcePath);
    if (file.state === "absent") { await this.#removeContained(base, file.sourcePath); return; }
    if (file.artifactPath === null || file.kind === null) throw new TypeError("Invalid present backup entry");
    await this.fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await this.#removeContained(base, file.sourcePath);
    const artifact = joinContained(snapshotRoot, file.artifactPath);
    if (file.kind === "directory") await this.fs.mkdir(target, { recursive: true, mode: file.mode ?? 0o700 });
    else if (file.kind === "symlink") await this.fs.symlink((await this.fs.readFile(artifact)).toString("utf8"), target);
    else {
      await this.fs.writeFile(target, await this.fs.readFile(artifact), { flag: "wx", mode: file.mode ?? 0o600 });
      if (file.mode !== null) await this.fs.chmod(target, file.mode);
    }
  }

  async #removeContained(base: string, path: string): Promise<void> {
    const target = joinContained(base, path);
    await this.#assertNoSymlinkParent(base, path);
    try { await this.fs.lstat(target); }
    catch (error) { if (isMissing(error)) return; throw error; }
    await this.fs.rm(target, { recursive: true, force: false });
  }

  async #assertNoSymlinkParent(base: string, path: string): Promise<void> {
    let cursor = base;
    for (const segment of assertSafeRelative(path).split("/").slice(0, -1)) {
      cursor = join(cursor, segment);
      try { if ((await this.fs.lstat(cursor)).isSymbolicLink()) throw new TypeError("Restore path traverses a symlink parent"); }
      catch (error) { if (isMissing(error)) return; throw error; }
    }
  }

  async #worktreeTopLevel(descriptor: RepositoryDescriptor): Promise<readonly string[]> {
    return (await this.fs.readdir(descriptor.runtimeRoot)).filter((entry) => entry.name !== ".git").map((entry) => entry.name);
  }
  #base(descriptor: RepositoryDescriptor, base: BackupFileSnapshot["base"]): string { return base === "worktree" ? descriptor.runtimeRoot : base === "git-dir" ? descriptor.gitDir : descriptor.commonDir; }
}
