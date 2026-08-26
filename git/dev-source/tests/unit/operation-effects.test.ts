import { describe, expect, it } from "vitest";

import {
  assertTrustedEffects,
  hasMutationEffects,
  isDestructiveOperationKind,
  OPERATION_EFFECTS,
  type OperationEffects,
  type OperationKind
} from "../../src/domain/OperationTypes";

const effectKeys: readonly (keyof OperationEffects)[] = [
  "network",
  "mutatesWorktree",
  "mutatesIndex",
  "mutatesGitConfig",
  "mutatesGitMetadata",
  "mutatesLocalRefs",
  "mutatesRemoteRefs",
  "destructive"
];

describe("orthogonal operation effects contract", () => {
  it("defines the complete effect vector for every operation", () => {
    const kinds = Object.keys(OPERATION_EFFECTS) as OperationKind[];

    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(Object.keys(OPERATION_EFFECTS[kind]).sort()).toEqual([...effectKeys].sort());
    }
  });

  it("models fetch, split pull strategies and push as orthogonal effects", () => {
    expect(OPERATION_EFFECTS.fetch).toMatchObject({
      network: true,
      mutatesLocalRefs: true,
      mutatesGitMetadata: true,
      mutatesWorktree: false,
      mutatesRemoteRefs: false
    });
    expect(OPERATION_EFFECTS["pull-ff-only"]).toMatchObject({
      network: true,
      mutatesWorktree: true,
      mutatesIndex: true,
      mutatesLocalRefs: true,
      mutatesGitMetadata: true
    });
    expect(OPERATION_EFFECTS["pull-merge"].destructive).toBe(false);
    expect(OPERATION_EFFECTS["pull-rebase"]).toMatchObject({
      network: true,
      mutatesWorktree: true,
      mutatesIndex: true,
      mutatesLocalRefs: true,
      destructive: true
    });
    expect(OPERATION_EFFECTS.push).toMatchObject({
      network: true,
      mutatesRemoteRefs: true,
      mutatesLocalRefs: false,
      mutatesWorktree: false
    });
  });

  it("fails closed when caller-declared effects differ from the central matrix", () => {
    expect(() => assertTrustedEffects("fetch", OPERATION_EFFECTS.status)).toThrow(
      "Operation effects mismatch for fetch:"
    );
    expect(() => assertTrustedEffects("pull-rebase", OPERATION_EFFECTS["pull-ff-only"])).toThrow();
    expect(() => assertTrustedEffects("pull-rebase", OPERATION_EFFECTS["pull-rebase"])).not.toThrow();
    expect(() => assertTrustedEffects("status", { ...OPERATION_EFFECTS.status, raw: true } as OperationEffects)).toThrow(
      "Operation effects shape mismatch for status"
    );
  });

  it("separates ordinary commit from destructive amend", () => {
    expect(OPERATION_EFFECTS.commit.destructive).toBe(false);
    expect(OPERATION_EFFECTS["amend-commit"]).toMatchObject({
      mutatesLocalRefs: true,
      mutatesGitMetadata: true,
      destructive: true
    });
    expect(isDestructiveOperationKind("amend-commit")).toBe(true);
    expect(hasMutationEffects(OPERATION_EFFECTS.fetch)).toBe(true);
    expect(OPERATION_EFFECTS["abort-operation"]).toMatchObject({
      mutatesGitMetadata: true,
      mutatesLocalRefs: true,
      destructive: true
    });
  });
});
