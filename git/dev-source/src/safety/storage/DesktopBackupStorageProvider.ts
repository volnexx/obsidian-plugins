import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { CanonicalAbsolutePath } from "../../domain/RepoRelativePath";
import { BackupError } from "../BackupErrors";
import type { BackupPlan } from "../BackupPlan";
import type { VerifiedBackupId } from "../SafetyBackupService";
import type { BackupStorageAllocation, BackupStorageProvider } from "./BackupStorageProvider";
import { NodeSafetyFileSystem, type SafetyFileSystem } from "./SafetyFileSystem";

const canonical = (path: string): CanonicalAbsolutePath => path.split(sep).join("/") as CanonicalAbsolutePath;
const overlaps = (left: string, right: string): boolean => {
  const rel = relative(left, right);
  const reverse = relative(right, left);
  const within = (value: string): boolean => value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
  return within(rel) || within(reverse);
};
const contains = (root: string, candidate: string): boolean => {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
};
const safeSegment = (value: string): string => createHash("sha256").update(value).digest("hex");

export const defaultBackupDataRoot = (namespace = "git"): string => {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "obsidian-git", "backups", safeSegment(namespace));
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "obsidian-git", "backups", safeSegment(namespace));
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "obsidian-git", "backups", safeSegment(namespace));
};

/** Desktop storage with canonical containment checks and same-filesystem atomic finalization. */
export class DesktopBackupStorageProvider implements BackupStorageProvider {
  readonly #configuredRoot: string;
  constructor(configuredRoot = defaultBackupDataRoot(), private readonly fs: SafetyFileSystem = new NodeSafetyFileSystem()) {
    this.#configuredRoot = resolve(configuredRoot);
  }

  async prepare(plan: BackupPlan, backupId: VerifiedBackupId): Promise<BackupStorageAllocation> {
    let temporaryPath: string | null = null;
    try {
      await this.fs.mkdir(this.#configuredRoot, { recursive: true, mode: 0o700 });
      const root = await this.fs.realpath(this.#configuredRoot);
      for (const participant of plan.participants) {
        for (const ownedPath of [participant.runtimeRoot, participant.gitDir, participant.commonDir]) {
          if (overlaps(root, ownedPath)) throw new BackupError("storage-not-isolated", "Backup storage overlaps repository-owned paths", plan.repoId, plan.sourcePlan.operationId);
        }
      }
      const repoDirectory = join(root, safeSegment(plan.repoId));
      await this.fs.mkdir(repoDirectory, { recursive: true, mode: 0o700 });
      const canonicalRepoDirectory = await this.fs.realpath(repoDirectory);
      if (!contains(root, canonicalRepoDirectory)) throw new BackupError("storage-not-isolated", "Repository backup directory escaped storage root", plan.repoId, plan.sourcePlan.operationId);
      const finalPath = join(canonicalRepoDirectory, backupId);
      try {
        await this.fs.lstat(finalPath);
        throw new BackupError("storage-unavailable", "Backup ID collision", plan.repoId, plan.sourcePlan.operationId);
      } catch (error) {
        if (error instanceof BackupError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      temporaryPath = await this.fs.mkdtemp(join(canonicalRepoDirectory, `.tmp-${backupId}-`));
      const tempReal = await this.fs.realpath(temporaryPath);
      const parentReal = await this.fs.realpath(dirname(finalPath));
      if (parentReal !== canonicalRepoDirectory || !basename(tempReal).startsWith(`.tmp-${backupId}-`)) throw new BackupError("storage-not-isolated", "Temporary backup escaped isolated storage", plan.repoId, plan.sourcePlan.operationId);
      const tempStat = await this.fs.stat(tempReal);
      const parentStat = await this.fs.stat(parentReal);
      if (tempStat.dev !== parentStat.dev) throw new BackupError("storage-unavailable", "Temporary and final backup paths are on different filesystems", plan.repoId, plan.sourcePlan.operationId);
      return Object.freeze({ backupId, repoId: plan.repoId, operationId: plan.sourcePlan.operationId, storageRoot: canonical(root), temporaryPath: canonical(tempReal), finalPath: canonical(finalPath), filesystemDevice: BigInt(tempStat.dev) });
    } catch (error) {
      if (temporaryPath !== null) {
        try { await this.fs.rm(temporaryPath, { recursive: true, force: true }); }
        catch { /* Failure to clean a newly allocated temporary directory must not mask the original error. */ }
      }
      if (error instanceof BackupError) throw error;
      throw new BackupError("storage-unavailable", "Backup storage is unavailable", plan.repoId, plan.sourcePlan.operationId, { cause: error });
    }
  }

  async finalize(allocation: BackupStorageAllocation): Promise<CanonicalAbsolutePath> {
    try {
      const root = await this.fs.realpath(allocation.storageRoot);
      const temp = await this.fs.realpath(allocation.temporaryPath);
      const parent = await this.fs.realpath(dirname(allocation.finalPath));
      if (!contains(root, temp) || !contains(root, parent) || parent === temp) throw new BackupError("storage-not-isolated", "Finalize path escaped storage root", allocation.repoId, allocation.operationId);
      if ((await this.fs.stat(temp)).dev !== (await this.fs.stat(parent)).dev) throw new BackupError("finalize-failed", "Atomic finalize requires one filesystem", allocation.repoId, allocation.operationId);
      await this.fs.rename(temp, allocation.finalPath);
      const finalized = await this.fs.realpath(allocation.finalPath);
      if (!contains(root, finalized)) throw new BackupError("storage-not-isolated", "Final backup escaped storage root", allocation.repoId, allocation.operationId);
      return canonical(finalized);
    } catch (error) {
      if (error instanceof BackupError) throw error;
      throw new BackupError("finalize-failed", "Atomic backup finalization failed", allocation.repoId, allocation.operationId, { cause: error });
    }
  }

  async cleanupPartial(allocation: BackupStorageAllocation): Promise<void> {
    try {
      const root = await this.fs.realpath(allocation.storageRoot);
      const temp = await this.fs.realpath(allocation.temporaryPath);
      if (!contains(root, temp) || !basename(temp).startsWith(`.tmp-${allocation.backupId}-`)) return;
      await this.fs.rm(temp, { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort and never weakens the original fail-closed result.
    }
  }
}
