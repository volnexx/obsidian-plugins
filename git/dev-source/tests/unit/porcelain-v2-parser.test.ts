import { describe, expect, it } from "vitest";

import type { OperationId, RepositoryId } from "../../src/domain/RepositoryId";
import { parsePorcelainV2Status } from "../../src/git/infrastructure/PorcelainV2Parser";

const repoId = "parser-repo" as RepositoryId;
const diagnostics = { repositoryId: repoId, operationId: "parser-operation" as OperationId, command: "status" } as const;
const nul = (...records: readonly string[]): Uint8Array => Buffer.from(`${records.join("\0")}\0`, "utf8");

describe("porcelain v2 -z parser", () => {
  it("parses branch state and canonical file entries without line-splitting pathnames", () => {
    const hash1 = "1".repeat(40);
    const hash2 = "2".repeat(40);
    const hash3 = "3".repeat(40);
    const observation = parsePorcelainV2Status(repoId, nul(
      `# branch.oid ${hash1}`,
      "# branch.head main",
      "# branch.upstream upstream/topic",
      "# branch.ab +2 -1",
      `1 MM N... 100644 100644 100644 ${hash1} ${hash2} src/file with spaces.ts`,
      `2 R. N... 100644 100644 100644 ${hash1} ${hash2} R100 новое\nимя.ts`,
      "старое\tимя.ts",
      "? Unicode/привет мир.txt",
      `u UU N... 100644 100644 100644 100644 ${hash1} ${hash2} ${hash3} conflict.txt`
    ), 100, diagnostics);

    expect(observation.branch).toEqual({ head: "main", detached: false, upstream: "upstream/topic", ahead: 2, behind: 1 });
    expect(observation.files[0]).toMatchObject({ path: "src/file with spaces.ts", indexStatus: "modified", worktreeStatus: "modified" });
    expect(observation.files[1]).toMatchObject({ path: "новое\nимя.ts", originalPath: "старое\tимя.ts", changeKind: "rename", similarity: 100 });
    expect(observation.files[2]).toMatchObject({ path: "Unicode/привет мир.txt", untracked: true });
    expect(observation.files[3]).toMatchObject({ path: "conflict.txt", changeKind: "unmerged", indexStatus: "unmerged", worktreeStatus: "unmerged" });
    expect(observation.files[3]?.conflictStages).toEqual({
      base: { mode: "100644", objectId: hash1 }, ours: { mode: "100644", objectId: hash2 }, theirs: { mode: "100644", objectId: hash3 }
    });
  });

  it("recognizes detached HEAD and fails closed on non-NUL output", () => {
    const detached = parsePorcelainV2Status(repoId, nul("# branch.head (detached)", "# branch.ab +0 -0"), 101, diagnostics);
    expect(detached.branch).toMatchObject({ head: null, detached: true });
    expect(() => parsePorcelainV2Status(repoId, Buffer.from("? incomplete"), 102, diagnostics)).toThrow("not NUL terminated");
  });
});
