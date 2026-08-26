import { describe, expect, it } from "vitest";

import type { VaultRelativePath } from "../../src/domain/RepoRelativePath";
import { assertReadOnlyArgv, STAGE_TWO_REPOSITORY_COMMANDS } from "../../src/git/infrastructure/GitCommandRunner";
import { PersistentRepositoryIdentityStore, type PersistedRepositoryIdentityData } from "../../src/git/infrastructure/RepositoryIdentityStore";

describe("stage-2 Git runner policy", () => {
  it("rejects every repository retargeting form before process invocation", () => {
    for (const argv of [["-C", "/other", "status"], ["-C/other", "status"], ["--git-dir=/other", "status"], ["--work-tree", "/other", "status"], ["--namespace=other", "status"], ["--bare", "status"]]) {
      expect(() => assertReadOnlyArgv(argv)).toThrow("retargeting");
    }
    expect(() => assertReadOnlyArgv(["status", "--porcelain=v2"])).not.toThrow();
    expect(() => assertReadOnlyArgv(["push"])).toThrow("read-only allowlist");
  });

  it("freezes the reviewed production command table", () => {
    expect(Object.isFrozen(STAGE_TWO_REPOSITORY_COMMANDS)).toBe(true);
    expect(Object.values(STAGE_TWO_REPOSITORY_COMMANDS).every(Object.isFrozen)).toBe(true);
  });

  it("preserves UUID identity through a vault move by using the portable locator", async () => {
    let saved: PersistedRepositoryIdentityData | undefined;
    const first = new PersistentRepositoryIdentityStore(undefined, (data) => { saved = data; return Promise.resolve(); });
    const locator = { kind: "vault-relative" as const, relativePath: ".obsidian/plugins/parsing" as VaultRelativePath };
    const original = await first.getOrCreate(locator);
    const afterMove = new PersistentRepositoryIdentityStore(saved, async () => Promise.resolve());
    expect(await afterMove.getOrCreate(locator)).toBe(original);
  });
});
