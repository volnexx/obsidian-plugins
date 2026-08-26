import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RepositoryDescriptor } from "../../src/domain/RepositoryDescriptor";
import type { RepositoryFamilyId, RepositoryId } from "../../src/domain/RepositoryId";
import type { BackupRequirement, BackupPlanParticipant } from "../../src/safety/BackupPlan";
import { BackupSnapshotEngine } from "../../src/safety/snapshot/BackupSnapshotEngine";

const roots: string[] = [];
const root = (): string => { const value = mkdtempSync(join(tmpdir(), "obsidian-git-safety-")); roots.push(value); return value; };
afterEach(() => roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true })));

const requirement: BackupRequirement = { worktree: "entire-worktree", worktreePaths: [], index: "none", refs: "none", refNames: [], gitObjects: false, gitConfig: false };
const descriptor = (path: string): RepositoryDescriptor => ({
  repositoryId: "repo-a" as RepositoryId, familyId: "family-a" as RepositoryFamilyId, name: "repo-a",
  locator: { kind: "external", locatorId: "repo-a", lastKnownAbsolutePath: path }, runtimeRoot: path as never,
  displayPath: path, gitDir: join(path, ".git") as never, commonDir: join(path, ".git") as never,
  superprojectRoot: null, objectFormat: "sha1", aliases: []
});

describe("safety foundation filesystem integration", () => {
  it("captures text, binary, zero-byte, executable and symlink entries without following links", async () => {
    const path = root(); mkdirSync(join(path, ".git"));
    writeFileSync(join(path, "text.txt"), "text\n"); writeFileSync(join(path, "binary.bin"), Buffer.from([0, 255, 1]));
    writeFileSync(join(path, "empty"), ""); writeFileSync(join(path, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    symlinkSync("text.txt", join(path, "link"));
    const engine = new BackupSnapshotEngine(); const repo = descriptor(path);
    const preflight = await engine.inspect(repo, requirement, new AbortController().signal, Date.now() + 5_000);
    const participant: BackupPlanParticipant = { repoId: repo.repositoryId, familyId: repo.familyId, runtimeRoot: repo.runtimeRoot, gitDir: repo.gitDir, commonDir: repo.commonDir, objectFormat: "sha1", impact: { repoId: repo.repositoryId, worktree: { scope: "entire-worktree", paths: [] }, index: { scope: "none", paths: [] }, gitConfig: { scope: "none", keys: [] }, gitMetadata: { scope: "none", namespaces: [] }, localRefs: { scope: "none", refs: [] }, remoteRefs: { scope: "none", targets: [] } }, requirements: requirement, preflightIdentity: preflight.digest };
    const backup = root();
    const captured = await engine.capture(participant, backup, 0, new AbortController().signal, Date.now() + 5_000);
    expect(captured.manifestParticipant.files.map((file) => [file.sourcePath, file.kind])).toEqual(expect.arrayContaining([["text.txt", "regular"], ["binary.bin", "regular"], ["empty", "regular"], ["run.sh", "regular"], ["link", "symlink"]]));
    await engine.verifyArtifacts(backup, captured.manifestParticipant);
  });
});
