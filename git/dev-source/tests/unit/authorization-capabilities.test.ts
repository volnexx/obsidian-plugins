import { describe, expect, it } from "vitest";

import {
  RuntimeAuthorizedGitOperationAuthority,
  RuntimeGitExecutionPermitAuthority,
  RuntimeParticipantQueueLeaseAuthority,
  RuntimeRepositoryBoundaryPermitAuthority,
  type GitExecutionSurface
} from "../../src/authorization/OperationAuthorization";
import { OPERATION_EFFECTS, type OperationImpactPlan } from "../../src/domain/OperationTypes";
import type { OperationId, RepositoryFamilyId, RepositoryId } from "../../src/domain/RepositoryId";
import {
  RuntimeValidatedOperationPlanAuthority,
  type CanonicalPayloadDigest,
  type CanonicalPlanDigest,
  type OperationPlanIdentity,
  type OperationPlanIntegrityVerifier,
  type RequiredOperationLock,
  type ValidatedOperationPlanData
} from "../../src/domain/ValidatedOperationPlan";

const repoA = "repo-a" as RepositoryId<"repo-a">;
const repoB = "repo-b" as RepositoryId<"repo-b">;
const family = "family-a" as RepositoryFamilyId;
const unrelatedFamily = "family-unrelated" as RepositoryFamilyId;
const noImpact = <Id extends RepositoryId>(repoId: Id): OperationImpactPlan<Id> => ({
  repoId,
  worktree: { scope: "none", paths: [] },
  index: { scope: "none", paths: [] },
  gitConfig: { scope: "none", keys: [] },
  gitMetadata: { scope: "none", namespaces: [] },
  localRefs: { scope: "none", refs: [] },
  remoteRefs: { scope: "none", targets: [] }
});

const sharedPlanData = (
  familyIds: RepositoryFamilyId[],
  relation: "shared-common-dir" | "nested" = "shared-common-dir"
): ValidatedOperationPlanData<typeof repoA, "status"> => {
  const repositoryIds: RepositoryId[] = [repoA, repoB];
  const acquisitionOrder: RequiredOperationLock[] = [
    { kind: "repository", repoId: repoA },
    { kind: "repository", repoId: repoB },
    ...familyIds.map((familyId) => ({ kind: "family" as const, familyId }))
  ];
  return {
    planIdentity: "plan-a" as OperationPlanIdentity,
    planDigest: "plan-digest-a" as CanonicalPlanDigest,
    payloadDigest: "payload-digest-a" as CanonicalPayloadDigest,
    repoId: repoA,
    operationId: "operation-a" as OperationId,
    kind: "status",
    payload: {},
    effects: OPERATION_EFFECTS.status,
    scope: {
      kind: "cross-context",
      relation,
      participants: [
        { repoId: repoB, impact: noImpact(repoB) },
        { repoId: repoA, impact: noImpact(repoA) }
      ]
    },
    requiredLocks: { repositoryIds, familyIds, acquisitionOrder },
    origin: "user",
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 1_000
  };
};

const repoBPlanData = (): ValidatedOperationPlanData<typeof repoB, "status"> => ({
  planIdentity: "plan-b" as OperationPlanIdentity,
  planDigest: "plan-digest-b" as CanonicalPlanDigest,
  payloadDigest: "payload-digest-b" as CanonicalPayloadDigest,
  repoId: repoB,
  operationId: "operation-b" as OperationId,
  kind: "status",
  payload: {},
  effects: OPERATION_EFFECTS.status,
  scope: { kind: "single-context", participants: [{ repoId: repoB, impact: noImpact(repoB) }] },
  requiredLocks: {
    repositoryIds: [repoB],
    familyIds: [],
    acquisitionOrder: [{ kind: "repository", repoId: repoB }]
  },
  origin: "user",
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 1_000
});

const exactFamilyIntegrity: OperationPlanIntegrityVerifier = {
  verifyPlanDigestAndRequiredLocks: (plan) => plan.requiredLocks.familyIds.length === 1 && plan.requiredLocks.familyIds[0] === family
};
const permissiveIntegrity: OperationPlanIntegrityVerifier = { verifyPlanDigestAndRequiredLocks: () => true };

describe("runtime operation capability provenance", () => {
  it("binds canonical required family locks to the immutable validated plan", () => {
    const authority = new RuntimeValidatedOperationPlanAuthority(exactFamilyIntegrity);
    const mutableFamilyIds: RepositoryFamilyId[] = [family];
    const data = sharedPlanData(mutableFamilyIds);
    const plan = authority.issue(data);

    mutableFamilyIds.push(unrelatedFamily);

    expect(plan.requiredLocks.familyIds).toEqual([family]);
    expect(plan.requiredLocks.repositoryIds).toEqual([repoA, repoB]);
    expect(Object.isFrozen(plan.requiredLocks)).toBe(true);
    expect(Object.isFrozen(plan.requiredLocks.familyIds)).toBe(true);
    expect(Object.isFrozen(plan.requiredLocks.acquisitionOrder)).toBe(true);
    expect(() => authority.issue(sharedPlanData([]))).toThrow("requires a repository-family lock");
    expect(() => authority.issue(sharedPlanData([family, unrelatedFamily]))).toThrow("integrity verification failed");
  });

  it("derives leases from the exact plan lock set and rejects missing or extra family locks", () => {
    const planAuthority = new RuntimeValidatedOperationPlanAuthority(permissiveIntegrity);
    const leaseAuthority = new RuntimeParticipantQueueLeaseAuthority(planAuthority);
    const exactPlan = planAuthority.issue(sharedPlanData([family]));
    const missingFamilyPlan = planAuthority.issue(sharedPlanData([], "nested"));
    const extraFamilyPlan = planAuthority.issue(sharedPlanData([family, unrelatedFamily], "nested"));

    const missingLease = leaseAuthority.issue(missingFamilyPlan, Date.now());
    expect(leaseAuthority.verifyActive(missingLease, exactPlan)).toBe(false);
    leaseAuthority.release(missingLease);

    const extraLease = leaseAuthority.issue(extraFamilyPlan, Date.now());
    expect(leaseAuthority.verifyActive(extraLease, exactPlan)).toBe(false);
    leaseAuthority.release(extraLease);

    const exactLease = leaseAuthority.issue(exactPlan, Date.now());
    expect(leaseAuthority.verifyActive(exactLease, exactPlan)).toBe(true);
    expect(exactLease.repositoryFamilyIds).toEqual([family]);
    expect(exactLease.acquisitionOrder).toEqual([
      { kind: "repository", repoId: repoA },
      { kind: "repository", repoId: repoB },
      { kind: "family", familyId: family }
    ]);
    leaseAuthority.release(exactLease);
  });

  it("binds backend authorization to exact runtime repoId and operation kind", () => {
    const planAuthority = new RuntimeValidatedOperationPlanAuthority(permissiveIntegrity);
    const boundaryAuthority = new RuntimeRepositoryBoundaryPermitAuthority();
    const executionAuthority = new RuntimeGitExecutionPermitAuthority();
    const leaseAuthority = new RuntimeParticipantQueueLeaseAuthority(planAuthority);
    const authorizedAuthority = new RuntimeAuthorizedGitOperationAuthority(planAuthority, boundaryAuthority, executionAuthority, leaseAuthority);
    const otherAuthorizedAuthority = new RuntimeAuthorizedGitOperationAuthority(planAuthority, boundaryAuthority, executionAuthority, leaseAuthority);
    const plan = planAuthority.issue(sharedPlanData([family]));
    const boundary = boundaryAuthority.issue(plan);
    const mutableDisabledSurfaces: GitExecutionSurface[] = ["hooks"];
    const execution = executionAuthority.issue(plan, {
      trust: "trusted",
      allowNetwork: false,
      allowMutation: false,
      allowRepositoryDefinedCode: false,
      disabledSurfaces: mutableDisabledSurfaces
    });
    const lease = leaseAuthority.issue(plan, Date.now());
    const authorized = authorizedAuthority.issue(plan, boundary, execution, lease);

    mutableDisabledSurfaces.push("credential-helper");
    expect(execution.profile.disabledSurfaces).toEqual(["hooks"]);
    expect(Object.isFrozen(execution.profile)).toBe(true);
    expect(Object.isFrozen(execution.profile.disabledSurfaces)).toBe(true);
    expect(authorizedAuthority.verifyFor(authorized, repoA, "status")).toBe(true);
    expect(authorizedAuthority.verifyFor(authorized, repoB, "status")).toBe(false);
    expect(authorizedAuthority.verifyFor(authorized, repoA, "stage")).toBe(false);
    expect(otherAuthorizedAuthority.verifyFor(authorized, repoA, "status")).toBe(false);

    leaseAuthority.release(lease);
    expect(authorizedAuthority.verifyFor(authorized, repoA, "status")).toBe(false);

    const planB = planAuthority.issue(repoBPlanData());
    const boundaryB = boundaryAuthority.issue(planB);
    const executionB = executionAuthority.issue(planB, execution.profile);
    const leaseB = leaseAuthority.issue(planB, Date.now());
    const authorizedB = authorizedAuthority.issue(planB, boundaryB, executionB, leaseB);
    expect(authorizedAuthority.verifyFor(authorizedB, repoA, "status")).toBe(false);
    expect(authorizedAuthority.verifyFor(authorizedB, repoB, "status")).toBe(true);
    leaseAuthority.release(leaseB);
  });

  it("rejects structural lookalikes and capabilities from another plan issuer", () => {
    const authorityA = new RuntimeValidatedOperationPlanAuthority(permissiveIntegrity);
    const authorityB = new RuntimeValidatedOperationPlanAuthority(permissiveIntegrity);
    const plan = authorityA.issue(sharedPlanData([family]));

    expect(authorityA.verify(plan)).toBe(true);
    expect(authorityB.verify(plan)).toBe(false);
    expect(authorityA.verify({
      planIdentity: plan.planIdentity,
      planDigest: plan.planDigest,
      payloadDigest: plan.payloadDigest,
      repoId: plan.repoId,
      operationId: plan.operationId,
      kind: plan.kind,
      payload: plan.payload,
      effects: plan.effects,
      scope: plan.scope,
      requiredLocks: plan.requiredLocks,
      origin: plan.origin,
      signal: plan.signal,
      deadlineAt: plan.deadlineAt
    })).toBe(false);
  });
});
