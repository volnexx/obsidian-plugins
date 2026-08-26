import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

import type { RepositoryDescriptor } from "../../domain/RepositoryDescriptor";
import type { RepoRelativePath } from "../../domain/RepoRelativePath";
import type { BackupArtifactBase, BackupFileKind, BackupFileSnapshot, BackupManifestParticipant, BackupRefState } from "../BackupManifest";
import { BackupError } from "../BackupErrors";
import type { BackupPlanParticipant, BackupPreflightIdentity, BackupRequirement, BackupStateInspector } from "../BackupPlan";
import type { SafetyFileSystem } from "../storage/SafetyFileSystem";
import { NodeSafetyFileSystem } from "../storage/SafetyFileSystem";

interface SourceSpec { readonly base: BackupArtifactBase; readonly path: string; }
interface InspectedSource extends SourceSpec {
  readonly state: "present" | "absent";
  readonly kind: BackupFileKind | null;
  readonly mode: number | null;
  readonly size: number;
  readonly mtimeMs: number | null;
  readonly sha256: string | null;
  readonly symlinkTarget: string | null;
}

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";
const normalizedRelative = (value: string): string => value.split("\\").join("/");
const assertSafeRelative = (value: string): string => {
  const normalized = normalizedRelative(value);
  if (normalized.length === 0 || normalized.includes("\0") || isAbsolute(value) || normalized.startsWith("/") || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError(`Unsafe snapshot path: ${JSON.stringify(value)}`);
  }
  return normalized;
};
const joinContained = (base: string, candidate: string): string => {
  const safe = assertSafeRelative(candidate);
  const result = join(base, ...safe.split("/"));
  const rel = relative(base, result);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new TypeError("Snapshot path escaped its base");
  return result;
};
const stableCompare = (left: string, right: string): number => Buffer.from(left).compare(Buffer.from(right));
const immutable = <Value>(value: Value): Value => {
  const copy = structuredClone(value);
  const deepFreeze = (item: unknown): void => {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const key of Reflect.ownKeys(item)) deepFreeze(Reflect.get(item, key));
    Object.freeze(item);
  };
  deepFreeze(copy);
  return copy;
};

export interface SnapshotCaptureResult {
  readonly manifestParticipant: BackupManifestParticipant;
  readonly artifactCount: number;
}

/** Filesystem-only snapshot engine. It never invokes Git or follows worktree symlinks. */
export class BackupSnapshotEngine implements BackupStateInspector {
  constructor(private readonly fs: SafetyFileSystem = new NodeSafetyFileSystem()) {}

  async inspect(descriptor: RepositoryDescriptor, requirement: BackupRequirement, signal: AbortSignal, deadlineAt: number): Promise<BackupPreflightIdentity> {
    this.#assertActive(signal, deadlineAt, descriptor.repositoryId, "inspect");
    const specs = await this.#sourceSpecs(descriptor, requirement, signal, deadlineAt);
    const inspected: InspectedSource[] = [];
    for (const spec of specs) inspected.push(await this.#inspectSource(descriptor, spec, signal, deadlineAt));
    return Object.freeze({ digest: sha256(JSON.stringify(inspected)) });
  }

  async capture(participant: BackupPlanParticipant, temporaryRoot: string, participantIndex: number, signal: AbortSignal, deadlineAt: number): Promise<SnapshotCaptureResult> {
    const descriptor: RepositoryDescriptor = {
      repositoryId: participant.repoId,
      familyId: participant.familyId,
      name: participant.repoId,
      locator: { kind: "external", locatorId: participant.repoId, lastKnownAbsolutePath: participant.runtimeRoot },
      runtimeRoot: participant.runtimeRoot,
      displayPath: participant.runtimeRoot,
      gitDir: participant.gitDir,
      commonDir: participant.commonDir,
      superprojectRoot: null,
      objectFormat: participant.objectFormat,
      aliases: []
    };
    const specs = await this.#sourceSpecs(descriptor, participant.requirements, signal, deadlineAt);
    const artifactDirectory = join(temporaryRoot, "artifacts", String(participantIndex));
    await this.fs.mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    const files: BackupFileSnapshot[] = [];
    for (const [index, spec] of specs.entries()) {
      this.#assertActive(signal, deadlineAt, participant.repoId, "capture");
      const inspected = await this.#inspectSource(descriptor, spec, signal, deadlineAt);
      let artifactPath: string | null = null;
      if (inspected.state === "present") {
        artifactPath = `artifacts/${participantIndex}/${String(index).padStart(8, "0")}`;
        const destination = joinContained(temporaryRoot, artifactPath);
        if (inspected.kind === "regular") {
          const bytes = await this.fs.readFile(this.#sourceAbsolute(descriptor, spec));
          if (sha256(bytes) !== inspected.sha256) throw new BackupError("stale-backup-plan", "File changed while it was copied", participant.repoId, "snapshot" as never);
          await this.fs.writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
        } else if (inspected.kind === "symlink") {
          await this.fs.writeFile(destination, Buffer.from(inspected.symlinkTarget ?? "", "utf8"), { flag: "wx", mode: 0o600 });
        } else {
          await this.fs.mkdir(destination, { mode: 0o700 });
        }
      }
      files.push({ base: spec.base, sourcePath: spec.path as RepoRelativePath, state: inspected.state, kind: inspected.kind, artifactPath, mode: inspected.mode, size: inspected.size, mtimeMs: inspected.mtimeMs, sha256: inspected.sha256, symlinkTarget: inspected.symlinkTarget });
    }
    const postflight = await this.inspect(descriptor, participant.requirements, signal, deadlineAt);
    if (postflight.digest !== participant.preflightIdentity) throw new BackupError("stale-backup-plan", "Protected repository state changed during backup", participant.repoId, "snapshot" as never);
    const refs = await this.#readRefState(descriptor, files);
    return immutable({
      manifestParticipant: {
        repoId: participant.repoId,
        familyId: participant.familyId,
        canonicalRoot: participant.runtimeRoot,
        gitDir: participant.gitDir,
        commonDir: participant.commonDir,
        objectFormat: participant.objectFormat,
        impact: participant.impact,
        requirements: participant.requirements,
        preflightIdentity: participant.preflightIdentity,
        postflightIdentity: postflight.digest,
        files,
        refs
      },
      artifactCount: files.filter((file) => file.artifactPath !== null).length
    });
  }

  async verifyArtifacts(snapshotRoot: string, participant: BackupManifestParticipant): Promise<void> {
    for (const file of participant.files) {
      if (file.state === "absent") {
        if (file.artifactPath !== null || file.sha256 !== null) throw new TypeError("Absent manifest entry has an artifact");
        continue;
      }
      if (file.artifactPath === null) throw new TypeError("Present manifest entry lacks an artifact");
      const path = joinContained(snapshotRoot, file.artifactPath);
      const stat = await this.fs.lstat(path);
      if (file.kind === "directory") {
        if (!stat.isDirectory()) throw new TypeError("Directory artifact has wrong type");
      } else {
        if (!stat.isFile()) throw new TypeError("Byte artifact has wrong type");
        const bytes = await this.fs.readFile(path);
        const expected = file.kind === "symlink" ? sha256(file.symlinkTarget ?? "") : file.sha256;
        if (sha256(bytes) !== expected) throw new TypeError("Backup artifact hash mismatch");
      }
    }
  }

  async #sourceSpecs(descriptor: RepositoryDescriptor, requirement: BackupRequirement, signal: AbortSignal, deadlineAt: number): Promise<readonly SourceSpec[]> {
    const specs: SourceSpec[] = [];
    if (requirement.worktree === "explicit-paths") {
      for (const path of requirement.worktreePaths) await this.#appendTree(descriptor.runtimeRoot, path, "worktree", specs, signal, deadlineAt, descriptor.repositoryId);
    } else if (requirement.worktree === "entire-worktree") {
      for (const entry of await this.#sortedEntries(descriptor.runtimeRoot)) {
        if (entry.name === ".git") continue;
        await this.#appendTree(descriptor.runtimeRoot, entry.name, "worktree", specs, signal, deadlineAt, descriptor.repositoryId);
      }
    }
    if (requirement.index === "full-index") {
      await this.#appendTree(descriptor.gitDir, "index", "git-dir", specs, signal, deadlineAt, descriptor.repositoryId);
      for (const base of [...new Set([descriptor.gitDir, descriptor.commonDir])]) {
        for (const entry of await this.#sortedEntriesIfPresent(base)) if (entry.name.startsWith("sharedindex.")) await this.#appendTree(base, entry.name, base === descriptor.gitDir ? "git-dir" : "common-dir", specs, signal, deadlineAt, descriptor.repositoryId);
      }
    }
    if (requirement.refs !== "none") {
      await this.#appendTree(descriptor.gitDir, "HEAD", "git-dir", specs, signal, deadlineAt, descriptor.repositoryId);
      if (requirement.refs === "all-local-refs") {
        await this.#appendTree(descriptor.commonDir, "refs", "common-dir", specs, signal, deadlineAt, descriptor.repositoryId);
        await this.#appendTree(descriptor.commonDir, "packed-refs", "common-dir", specs, signal, deadlineAt, descriptor.repositoryId);
      } else {
        for (const ref of requirement.refNames) await this.#appendTree(descriptor.commonDir, assertSafeRelative(ref), "common-dir", specs, signal, deadlineAt, descriptor.repositoryId);
        await this.#appendTree(descriptor.commonDir, "packed-refs", "common-dir", specs, signal, deadlineAt, descriptor.repositoryId);
      }
    }
    if (requirement.gitObjects) await this.#appendTree(descriptor.commonDir, "objects", "common-dir", specs, signal, deadlineAt, descriptor.repositoryId);
    if (requirement.gitConfig) {
      await this.#appendTree(descriptor.commonDir, "config", "common-dir", specs, signal, deadlineAt, descriptor.repositoryId);
      await this.#appendTree(descriptor.gitDir, "config.worktree", "git-dir", specs, signal, deadlineAt, descriptor.repositoryId);
    }
    const unique = new Map<string, SourceSpec>();
    for (const spec of specs) unique.set(`${spec.base}\0${spec.path}`, spec);
    return [...unique.values()].sort((left, right) => stableCompare(`${left.base}/${left.path}`, `${right.base}/${right.path}`));
  }

  async #appendTree(base: string, path: string, artifactBase: BackupArtifactBase, output: SourceSpec[], signal: AbortSignal, deadlineAt: number, repoId: string): Promise<void> {
    this.#assertActive(signal, deadlineAt, repoId, "enumerate");
    const safe = assertSafeRelative(path);
    const absolute = joinContained(base, safe);
    await this.#assertNoSymlinkParent(base, safe);
    output.push({ base: artifactBase, path: safe });
    let stat;
    try { stat = await this.fs.lstat(absolute); } catch (error) { if (isMissing(error)) return; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    for (const entry of await this.#sortedEntries(absolute)) await this.#appendTree(base, `${safe}/${entry.name}`, artifactBase, output, signal, deadlineAt, repoId);
  }

  async #inspectSource(descriptor: RepositoryDescriptor, spec: SourceSpec, signal: AbortSignal, deadlineAt: number): Promise<InspectedSource> {
    this.#assertActive(signal, deadlineAt, descriptor.repositoryId, "inspect-source");
    const base = this.#base(descriptor, spec.base);
    await this.#assertNoSymlinkParent(base, spec.path);
    const absolute = joinContained(base, spec.path);
    try {
      const stat = await this.fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        const target = await this.fs.readlink(absolute);
        return { ...spec, state: "present", kind: "symlink", mode: stat.mode, size: Buffer.byteLength(target), mtimeMs: stat.mtimeMs, sha256: sha256(target), symlinkTarget: target };
      }
      if (stat.isDirectory()) return { ...spec, state: "present", kind: "directory", mode: stat.mode, size: 0, mtimeMs: stat.mtimeMs, sha256: sha256("directory"), symlinkTarget: null };
      if (!stat.isFile()) throw new TypeError("Unsupported filesystem object in backup scope");
      const bytes = await this.fs.readFile(absolute);
      return { ...spec, state: "present", kind: "regular", mode: stat.mode, size: bytes.byteLength, mtimeMs: stat.mtimeMs, sha256: sha256(bytes), symlinkTarget: null };
    } catch (error) {
      if (isMissing(error)) return { ...spec, state: "absent", kind: null, mode: null, size: 0, mtimeMs: null, sha256: null, symlinkTarget: null };
      throw error;
    }
  }

  async #assertNoSymlinkParent(base: string, path: string): Promise<void> {
    const parts = assertSafeRelative(path).split("/").slice(0, -1);
    let cursor = base;
    for (const part of parts) {
      cursor = join(cursor, part);
      try {
        if ((await this.fs.lstat(cursor)).isSymbolicLink()) throw new TypeError("Snapshot path traverses a symlink parent");
      } catch (error) { if (isMissing(error)) return; throw error; }
    }
  }

  async #readRefState(descriptor: RepositoryDescriptor, files: readonly BackupFileSnapshot[]): Promise<BackupRefState> {
    const headEntry = files.find((file) => file.base === "git-dir" && file.sourcePath === "HEAD" && file.state === "present");
    let headRaw: string | null = null;
    if (headEntry !== undefined) headRaw = (await this.fs.readFile(joinContained(descriptor.gitDir, "HEAD"))).toString("utf8").trim();
    const refs: { name: string; objectId: string | null; symbolicTarget: string | null }[] = [];
    for (const file of files) {
      if (file.base !== "common-dir" || !file.sourcePath.startsWith("refs/") || file.state !== "present" || file.kind !== "regular") continue;
      const raw = (await this.fs.readFile(joinContained(descriptor.commonDir, file.sourcePath))).toString("utf8").trim();
      refs.push(raw.startsWith("ref: ") ? { name: file.sourcePath, objectId: null, symbolicTarget: raw.slice(5) } : { name: file.sourcePath, objectId: raw || null, symbolicTarget: null });
    }
    let headObjectId: string | null = headRaw !== null && !headRaw.startsWith("ref: ") ? headRaw : null;
    const headRef = headRaw?.startsWith("ref: ") === true ? headRaw.slice(5) : null;
    if (headRef !== null) headObjectId = refs.find((ref) => ref.name === headRef)?.objectId ?? null;
    return Object.freeze({ headRaw, headObjectId, refs: Object.freeze(refs.sort((left, right) => stableCompare(left.name, right.name)).map((ref) => Object.freeze(ref))) });
  }

  #sourceAbsolute(descriptor: RepositoryDescriptor, spec: SourceSpec): string { return joinContained(this.#base(descriptor, spec.base), spec.path); }
  #base(descriptor: RepositoryDescriptor, base: BackupArtifactBase): string { return base === "worktree" ? descriptor.runtimeRoot : base === "git-dir" ? descriptor.gitDir : descriptor.commonDir; }
  async #sortedEntries(path: string): Promise<readonly { readonly name: string }[]> { return [...await this.fs.readdir(path)].sort((left, right) => stableCompare(left.name, right.name)); }
  async #sortedEntriesIfPresent(path: string): Promise<readonly { readonly name: string }[]> { try { return await this.#sortedEntries(path); } catch (error) { if (isMissing(error)) return []; throw error; } }
  #assertActive(signal: AbortSignal, deadlineAt: number, repoId: string, phase: string): void {
    if (signal.aborted) throw new BackupError("cancelled", `Backup cancelled during ${phase}`, repoId as never, "snapshot" as never);
    if (Date.now() > deadlineAt) throw new BackupError("timeout", `Backup deadline elapsed during ${phase}`, repoId as never, "snapshot" as never);
  }
}
