import { describe, expect, it } from "vitest";

import type { RepositoryId } from "../../src/domain/RepositoryId";
import type { RepositoryObservation } from "../../src/domain/RepositorySnapshot";
import { RuntimeRepoStore } from "../../src/state/RepoStore";

const observation = <Id extends RepositoryId>(repositoryId: Id, observedAt: number): RepositoryObservation<Id> => Object.freeze({
  repositoryId, branch: Object.freeze({ head: "main", detached: false, upstream: null, ahead: 0, behind: 0 }), files: Object.freeze([]), observedAt
});

describe("per-repository RepoStore", () => {
  it("assigns monotonic generations and rejects stale observations", () => {
    const repo = "repo-store" as RepositoryId;
    const store = new RuntimeRepoStore(repo, () => 500);
    expect(store.applyObservation(observation(repo, 10))).toBe(true);
    expect(store.snapshot?.generation).toBe(1);
    expect(store.applyObservation(observation(repo, 9))).toBe(false);
    expect(store.snapshot?.generation).toBe(1);
    expect(store.applyObservation(observation(repo, 11))).toBe(true);
    expect(store.snapshot?.generation).toBe(2);
  });

  it("rejects cross-repository observations and keeps errors isolated", () => {
    const repoA = "repo-store-a" as RepositoryId;
    const repoB = "repo-store-b" as RepositoryId;
    const storeA = new RuntimeRepoStore(repoA);
    const storeB = new RuntimeRepoStore(repoB);
    expect(() => storeA.applyObservation(observation(repoB, 1))).toThrow("another repository");
    storeA.fail({ code: "test", message: "A only", operationId: null });
    expect(storeA.lastError?.message).toBe("A only");
    expect(storeB.lastError).toBeNull();
  });
});
