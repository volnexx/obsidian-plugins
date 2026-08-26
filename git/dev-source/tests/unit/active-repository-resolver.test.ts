import { describe, expect, it } from "vitest";

import { ActiveRepositoryResolver } from "../../src/core/ActiveRepositoryResolver";
import type { CanonicalAbsolutePath } from "../../src/domain/RepoRelativePath";
import type { RepositoryId } from "../../src/domain/RepositoryId";

const path = (value: string): CanonicalAbsolutePath => value as CanonicalAbsolutePath;
const repoA = "resolver-a" as RepositoryId;
const repoB = "resolver-b" as RepositoryId;

describe("ActiveRepositoryResolver", () => {
  it("uses longest-root matching for nested repositories", () => {
    const resolver = new ActiveRepositoryResolver(() => [
      { repoId: repoA, lifecycle: "ready", roots: [path("/vault")] },
      { repoId: repoB, lifecycle: "ready", roots: [path("/vault/.config/plugins/nested")] }
    ]);
    expect(resolver.resolve(path("/vault/.config/plugins/nested/src/main.ts"))).toEqual({ kind: "resolved", repoId: repoB });
    expect(resolver.resolve(path("/vault/note.md"))).toEqual({ kind: "resolved", repoId: repoA });
    expect(resolver.resolve(path("/elsewhere/file"))).toEqual({ kind: "outside" });
  });

  it("resolves disjoint, submodule and linked-worktree roots independently of Git metadata sharing", () => {
    const repoC = "resolver-c" as RepositoryId;
    const repoD = "resolver-d" as RepositoryId;
    const resolver = new ActiveRepositoryResolver(() => [
      { repoId: repoA, lifecycle: "ready", roots: [path("/vault/plugins/a")] },
      { repoId: repoB, lifecycle: "ready", roots: [path("/vault/plugins/b")] },
      { repoId: repoC, lifecycle: "ready", roots: [path("/super/modules/sub")] },
      { repoId: repoD, lifecycle: "ready", roots: [path("/worktrees/linked")] }
    ]);
    expect(resolver.resolve(path("/vault/plugins/a/src/a.ts"))).toEqual({ kind: "resolved", repoId: repoA });
    expect(resolver.resolve(path("/vault/plugins/b/src/b.ts"))).toEqual({ kind: "resolved", repoId: repoB });
    expect(resolver.resolve(path("/super/modules/sub/file.ts"))).toEqual({ kind: "resolved", repoId: repoC });
    expect(resolver.resolve(path("/worktrees/linked/file.ts"))).toEqual({ kind: "resolved", repoId: repoD });
  });

  it("reports missing and ambiguous matches explicitly", () => {
    const missing = new ActiveRepositoryResolver(() => [{ repoId: repoA, lifecycle: "missing", roots: [path("/repo")] }]);
    expect(missing.resolve(path("/repo/file"))).toEqual({ kind: "missing", repoId: repoA });
    const ambiguous = new ActiveRepositoryResolver(() => [
      { repoId: repoA, lifecycle: "ready", roots: [path("/same")] },
      { repoId: repoB, lifecycle: "ready", roots: [path("/same")] }
    ]);
    expect(ambiguous.resolve(path("/same/file"))).toEqual({ kind: "ambiguous", repoIds: [repoA, repoB] });
  });
});
