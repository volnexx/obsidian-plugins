import type { OperationKind, OperationPayload } from "./OperationRequests";
import { assertTrustedEffects, type OperationEffectsFor, type OperationImpactPlan, type OperationOrigin } from "./OperationTypes";
import type { OperationId, RepositoryFamilyId, RepositoryId } from "./RepositoryId";
import type { RepositoryRelationKind } from "./RepositoryRelation";

declare const planIdentityBrand: unique symbol;
declare const planDigestBrand: unique symbol;
declare const payloadDigestBrand: unique symbol;

export type OperationPlanIdentity = string & { readonly [planIdentityBrand]: true };
export type CanonicalPlanDigest = string & { readonly [planDigestBrand]: true };
export type CanonicalPayloadDigest = string & { readonly [payloadDigestBrand]: true };
export interface OperationPlanIdentityBinding { readonly planIdentity: OperationPlanIdentity; readonly planDigest: CanonicalPlanDigest; readonly payloadDigest: CanonicalPayloadDigest; }
export interface OperationParticipantImpact<Id extends RepositoryId = RepositoryId> { readonly repoId: Id; readonly impact: OperationImpactPlan<Id>; }
export type RequiredOperationLock =
  | { readonly kind: "repository"; readonly repoId: RepositoryId }
  | { readonly kind: "family"; readonly familyId: RepositoryFamilyId };
export interface RequiredOperationLockSet {
  readonly repositoryIds: readonly RepositoryId[];
  readonly familyIds: readonly RepositoryFamilyId[];
  readonly acquisitionOrder: readonly RequiredOperationLock[];
}

export type ValidatedOperationScope<Id extends RepositoryId = RepositoryId> =
  | { readonly kind: "single-context"; readonly participants: readonly [OperationParticipantImpact<Id>] }
  | { readonly kind: "cross-context"; readonly relation: Exclude<RepositoryRelationKind, "disjoint">; readonly participants: readonly [OperationParticipantImpact, OperationParticipantImpact, ...OperationParticipantImpact[]] };

export interface ValidatedOperationPlanData<Id extends RepositoryId, Kind extends OperationKind> extends OperationPlanIdentityBinding {
  readonly repoId: Id;
  readonly operationId: OperationId;
  readonly kind: Kind;
  readonly payload: Readonly<OperationPayload<Kind>>;
  readonly effects: OperationEffectsFor<Kind>;
  readonly scope: ValidatedOperationScope<Id>;
  /** Included in canonical planDigest and derived only by the trusted planner/relation graph. */
  readonly requiredLocks: RequiredOperationLockSet;
  readonly origin: OperationOrigin;
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
}

export interface OperationPlanIntegrityVerifier {
  verifyPlanDigestAndRequiredLocks<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlanData<Id, Kind>): boolean;
}

const planConstructionToken = Symbol("validated-operation-plan-construction");
const planIssuers = new WeakMap<object, symbol>();

const immutableSnapshot = <Value>(value: Value): Value => {
  const snapshot = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || ArrayBuffer.isView(candidate) || Object.isFrozen(candidate)) return;
    for (const key of Reflect.ownKeys(candidate)) {
      const nested: unknown = Reflect.get(candidate, key);
      freeze(nested);
    }
    Object.freeze(candidate);
  };
  freeze(snapshot);
  return snapshot;
};

const equalSequence = <Value>(left: readonly Value[], right: readonly Value[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const equalRequiredLock = (left: RequiredOperationLock, right: RequiredOperationLock | undefined): boolean =>
  left.kind === "repository"
    ? right?.kind === "repository" && left.repoId === right.repoId
    : right?.kind === "family" && left.familyId === right.familyId;

const assertCanonicalRequiredLocks = (data: ValidatedOperationPlanData<RepositoryId, OperationKind>): void => {
  const expectedRepositories = [...new Set(data.scope.participants.map((participant) => participant.repoId))].sort((left, right) => left.localeCompare(right));
  const canonicalFamilies = [...new Set(data.requiredLocks.familyIds)].sort((left, right) => left.localeCompare(right));
  const expectedOrder: RequiredOperationLock[] = [
    ...expectedRepositories.map((repoId) => ({ kind: "repository", repoId }) as const),
    ...canonicalFamilies.map((familyId) => ({ kind: "family", familyId }) as const)
  ];
  const orderMatches = data.requiredLocks.acquisitionOrder.length === expectedOrder.length
    && data.requiredLocks.acquisitionOrder.every((lock, index) => equalRequiredLock(lock, expectedOrder[index]));
  if (!equalSequence(data.requiredLocks.repositoryIds, expectedRepositories) || !equalSequence(data.requiredLocks.familyIds, canonicalFamilies) || !orderMatches) {
    throw new TypeError("Operation plan required lock set is not canonical");
  }
  if (data.scope.kind === "cross-context" && data.scope.relation === "shared-common-dir" && canonicalFamilies.length === 0) {
    throw new TypeError("Shared-common-dir operation requires a repository-family lock");
  }
};

/** Runtime capability. Structural lookalikes and capabilities from another authority are rejected. */
export class ValidatedOperationPlan<Id extends RepositoryId = RepositoryId, Kind extends OperationKind = OperationKind>
  implements ValidatedOperationPlanData<Id, Kind> {
  declare private readonly runtimeCapability: typeof planConstructionToken;
  readonly planIdentity: OperationPlanIdentity;
  readonly planDigest: CanonicalPlanDigest;
  readonly payloadDigest: CanonicalPayloadDigest;
  readonly repoId: Id;
  readonly operationId: OperationId;
  readonly kind: Kind;
  readonly payload: Readonly<OperationPayload<Kind>>;
  readonly effects: OperationEffectsFor<Kind>;
  readonly scope: ValidatedOperationScope<Id>;
  readonly requiredLocks: RequiredOperationLockSet;
  readonly origin: OperationOrigin;
  readonly signal: AbortSignal;
  readonly deadlineAt: number;

  constructor(token: typeof planConstructionToken, data: ValidatedOperationPlanData<Id, Kind>) {
    if (token !== planConstructionToken) throw new TypeError("ValidatedOperationPlan must be issued by its runtime authority");
    this.planIdentity = data.planIdentity;
    this.planDigest = data.planDigest;
    this.payloadDigest = data.payloadDigest;
    this.repoId = data.repoId;
    this.operationId = data.operationId;
    this.kind = data.kind;
    this.payload = data.payload;
    this.effects = data.effects;
    this.scope = data.scope;
    this.requiredLocks = data.requiredLocks;
    this.origin = data.origin;
    this.signal = data.signal;
    this.deadlineAt = data.deadlineAt;
    Object.freeze(this);
  }
}

export interface ValidatedOperationPlanVerifier {
  verify(candidate: unknown): candidate is ValidatedOperationPlan;
}

/** A concrete authority instance is a capability; only its issued plans verify against it. */
export class RuntimeValidatedOperationPlanAuthority implements ValidatedOperationPlanVerifier {
  readonly #issuerId = Symbol("validated-operation-plan-issuer");

  constructor(private readonly integrityVerifier: OperationPlanIntegrityVerifier) {}

  issue<Id extends RepositoryId, Kind extends OperationKind>(data: ValidatedOperationPlanData<Id, Kind>): ValidatedOperationPlan<Id, Kind> {
    const snapshot: ValidatedOperationPlanData<Id, Kind> = {
      ...data,
      payload: immutableSnapshot(data.payload),
      effects: immutableSnapshot(data.effects),
      scope: immutableSnapshot(data.scope),
      requiredLocks: immutableSnapshot(data.requiredLocks)
    };
    assertTrustedEffects(snapshot.kind, snapshot.effects);
    assertCanonicalRequiredLocks(snapshot);
    if (!this.integrityVerifier.verifyPlanDigestAndRequiredLocks(snapshot)) throw new TypeError("Operation plan integrity verification failed");
    const plan = new ValidatedOperationPlan(planConstructionToken, snapshot);
    planIssuers.set(plan, this.#issuerId);
    return plan;
  }

  verify(candidate: unknown): candidate is ValidatedOperationPlan {
    if (!(candidate instanceof ValidatedOperationPlan) || planIssuers.get(candidate) !== this.#issuerId) return false;
    return Object.isFrozen(candidate) && this.integrityVerifier.verifyPlanDigestAndRequiredLocks(candidate);
  }
}
