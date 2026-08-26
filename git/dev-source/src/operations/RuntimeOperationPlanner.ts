import { createHash, randomUUID } from "node:crypto";

import { OPERATION_EFFECTS, type OperationImpactPlan, type OperationIntent } from "../domain/OperationTypes";
import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryFamilyId, RepositoryId } from "../domain/RepositoryId";
import { RuntimeValidatedOperationPlanAuthority, type CanonicalPayloadDigest, type CanonicalPlanDigest, type OperationPlanIdentity, type OperationPlanIntegrityVerifier, type RequiredOperationLock, type ValidatedOperationPlan, type ValidatedOperationPlanData } from "../domain/ValidatedOperationPlan";
import type { OperationPlanner } from "./OperationPlanner";

export interface RepositoryPlanningFamily {
  readonly familyId: RepositoryFamilyId;
  readonly memberCount: number;
}

export interface RepositoryPlanningTopology {
  family(repoId: RepositoryId): RepositoryPlanningFamily | null;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stableValue(nested)]));
  return value;
};
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
const payloadDigest = (payload: unknown): CanonicalPayloadDigest => digest(payload) as CanonicalPayloadDigest;
const planDigest = (data: Omit<ValidatedOperationPlanData<RepositoryId, OperationKind>, "planDigest" | "signal">): CanonicalPlanDigest => digest(data) as CanonicalPlanDigest;
const noImpact = <Id extends RepositoryId>(repoId: Id): OperationImpactPlan<Id> => ({
  repoId,
  worktree: { scope: "none", paths: [] }, index: { scope: "none", paths: [] }, gitConfig: { scope: "none", keys: [] },
  gitMetadata: { scope: "none", namespaces: [] }, localRefs: { scope: "none", refs: [] }, remoteRefs: { scope: "none", targets: [] }
});

export class RuntimeOperationPlanIntegrityVerifier implements OperationPlanIntegrityVerifier {
  constructor(private readonly topology: RepositoryPlanningTopology) {}

  verifyPlanDigestAndRequiredLocks<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlanData<Id, Kind>): boolean {
    const repositoryIds = [...new Set(plan.scope.participants.map((participant) => participant.repoId))].sort((left, right) => left.localeCompare(right));
    const familyIds = [...new Set(repositoryIds.flatMap((repoId) => {
      const family = this.topology.family(repoId);
      return family !== null && family.memberCount > 1 ? [family.familyId] : [];
    }))].sort((left, right) => left.localeCompare(right));
    if (repositoryIds.length !== plan.requiredLocks.repositoryIds.length || repositoryIds.some((id, index) => id !== plan.requiredLocks.repositoryIds[index])) return false;
    if (familyIds.length !== plan.requiredLocks.familyIds.length || familyIds.some((id, index) => id !== plan.requiredLocks.familyIds[index])) return false;
    const digestible = {
      planIdentity: plan.planIdentity, payloadDigest: plan.payloadDigest, repoId: plan.repoId, operationId: plan.operationId,
      kind: plan.kind, payload: plan.payload, effects: plan.effects, scope: plan.scope, requiredLocks: plan.requiredLocks,
      origin: plan.origin, deadlineAt: plan.deadlineAt
    };
    return plan.planDigest === planDigest(digestible);
  }
}

export class RuntimeOperationPlanner implements OperationPlanner {
  readonly authority: RuntimeValidatedOperationPlanAuthority;

  constructor(private readonly topology: RepositoryPlanningTopology) {
    this.authority = new RuntimeValidatedOperationPlanAuthority(new RuntimeOperationPlanIntegrityVerifier(topology));
  }

  plan<Id extends RepositoryId, Kind extends OperationKind>(intent: OperationIntent<Id, Kind>): Promise<ValidatedOperationPlan<Id, Kind>> {
    if (intent.kind !== "probe" && intent.kind !== "status") return Promise.reject(new TypeError(`Operation ${intent.kind} is outside the stage-2 read-only planner allowlist`));
    const family = this.topology.family(intent.repoId);
    const familyIds = family !== null && family.memberCount > 1 ? [family.familyId] : [];
    const repositoryIds: readonly RepositoryId[] = [intent.repoId];
    const acquisitionOrder: readonly RequiredOperationLock[] = [
      { kind: "repository", repoId: intent.repoId },
      ...familyIds.map((familyId) => ({ kind: "family" as const, familyId }))
    ];
    const identity = randomUUID() as OperationPlanIdentity;
    const payloadHash = payloadDigest(intent.payload);
    const base = {
      planIdentity: identity, payloadDigest: payloadHash, repoId: intent.repoId, operationId: intent.operationId,
      kind: intent.kind, payload: intent.payload, effects: OPERATION_EFFECTS[intent.kind],
      scope: { kind: "single-context" as const, participants: [{ repoId: intent.repoId, impact: noImpact(intent.repoId) }] as const },
      requiredLocks: { repositoryIds, familyIds, acquisitionOrder }, origin: intent.origin, deadlineAt: intent.deadlineAt
    };
    const data = { ...base, signal: intent.signal, planDigest: planDigest(base) } as ValidatedOperationPlanData<Id, Kind>;
    return Promise.resolve(this.authority.issue(data));
  }
}
