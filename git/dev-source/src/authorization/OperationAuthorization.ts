import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryFamilyId, RepositoryId } from "../domain/RepositoryId";
import type { RepositoryTrust } from "../domain/RepositoryTrust";
import type { CanonicalPlanDigest, OperationPlanIdentity, RequiredOperationLock, ValidatedOperationPlan, ValidatedOperationPlanVerifier } from "../domain/ValidatedOperationPlan";

export type GitExecutionSurface = "hooks" | "hooks-path" | "fsmonitor" | "credential-helper" | "ssh-command" | "filter" | "merge-driver" | "external-diff" | "textconv" | "editor" | "pager" | "unknown";
export interface GitExecutionProfile { readonly trust: RepositoryTrust; readonly allowNetwork: boolean; readonly allowMutation: boolean; readonly allowRepositoryDefinedCode: boolean; readonly disabledSurfaces: readonly GitExecutionSurface[]; }

const boundaryToken = Symbol("repository-boundary-permit-construction");
const executionToken = Symbol("git-execution-permit-construction");
const queueLeaseToken = Symbol("participant-queue-lease-construction");
const authorizedToken = Symbol("authorized-git-operation-construction");
const boundaryIssuers = new WeakMap<object, symbol>();
const executionIssuers = new WeakMap<object, symbol>();
const queueLeaseIssuers = new WeakMap<object, { readonly issuerId: symbol; readonly lockKeys: readonly string[]; active: boolean }>();
const authorizedIssuers = new WeakMap<object, symbol>();

const equalRequiredLock = (left: RequiredOperationLock, right: RequiredOperationLock | undefined): boolean =>
  left.kind === "repository"
    ? right?.kind === "repository" && left.repoId === right.repoId
    : right?.kind === "family" && left.familyId === right.familyId;

export class RepositoryBoundaryPermit {
  declare private readonly runtimeCapability: typeof boundaryToken;
  constructor(token: typeof boundaryToken, readonly planIdentity: OperationPlanIdentity, readonly planDigest: CanonicalPlanDigest, readonly participantRepoIds: readonly RepositoryId[]) {
    if (token !== boundaryToken) throw new TypeError("RepositoryBoundaryPermit must be issued by its runtime authority");
    Object.freeze(this);
  }
}

export class RuntimeRepositoryBoundaryPermitAuthority {
  readonly #issuerId = Symbol("repository-boundary-permit-issuer");
  issue<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>): RepositoryBoundaryPermit {
    const participantRepoIds = plan.scope.participants.map((participant) => participant.repoId);
    const permit = new RepositoryBoundaryPermit(boundaryToken, plan.planIdentity, plan.planDigest, Object.freeze(participantRepoIds));
    boundaryIssuers.set(permit, this.#issuerId);
    return permit;
  }
  verify<Id extends RepositoryId, Kind extends OperationKind>(candidate: unknown, plan: ValidatedOperationPlan<Id, Kind>): candidate is RepositoryBoundaryPermit {
    if (!(candidate instanceof RepositoryBoundaryPermit) || boundaryIssuers.get(candidate) !== this.#issuerId) return false;
    const expected = plan.scope.participants.map((participant) => participant.repoId);
    return candidate.planIdentity === plan.planIdentity && candidate.planDigest === plan.planDigest && candidate.participantRepoIds.length === expected.length && candidate.participantRepoIds.every((repoId, index) => repoId === expected[index]);
  }
}

export class GitExecutionPermit {
  declare private readonly runtimeCapability: typeof executionToken;
  constructor(token: typeof executionToken, readonly planIdentity: OperationPlanIdentity, readonly planDigest: CanonicalPlanDigest, readonly profile: GitExecutionProfile) {
    if (token !== executionToken) throw new TypeError("GitExecutionPermit must be issued by its runtime authority");
    Object.freeze(this);
  }
}

export class RuntimeGitExecutionPermitAuthority {
  readonly #issuerId = Symbol("git-execution-permit-issuer");
  issue<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>, profile: GitExecutionProfile): GitExecutionPermit {
    const profileSnapshot: GitExecutionProfile = Object.freeze({
      trust: profile.trust,
      allowNetwork: profile.allowNetwork,
      allowMutation: profile.allowMutation,
      allowRepositoryDefinedCode: profile.allowRepositoryDefinedCode,
      disabledSurfaces: Object.freeze([...profile.disabledSurfaces])
    });
    const permit = new GitExecutionPermit(executionToken, plan.planIdentity, plan.planDigest, profileSnapshot);
    executionIssuers.set(permit, this.#issuerId);
    return permit;
  }
  verify<Id extends RepositoryId, Kind extends OperationKind>(candidate: unknown, plan: ValidatedOperationPlan<Id, Kind>): candidate is GitExecutionPermit {
    return candidate instanceof GitExecutionPermit && executionIssuers.get(candidate) === this.#issuerId && candidate.planIdentity === plan.planIdentity && candidate.planDigest === plan.planDigest;
  }
}

export class ParticipantQueueLease {
  declare private readonly runtimeCapability: typeof queueLeaseToken;
  constructor(token: typeof queueLeaseToken, readonly planIdentity: OperationPlanIdentity, readonly planDigest: CanonicalPlanDigest, readonly participantRepoIds: readonly RepositoryId[], readonly repositoryFamilyIds: readonly RepositoryFamilyId[], readonly acquisitionOrder: readonly RequiredOperationLock[], readonly acquiredAt: number) {
    if (token !== queueLeaseToken) throw new TypeError("ParticipantQueueLease must be issued by its runtime authority");
    Object.freeze(this);
  }
}

export class RuntimeParticipantQueueLeaseAuthority {
  readonly #issuerId = Symbol("participant-queue-lease-issuer");
  readonly #activeLockKeys = new Set<string>();
  constructor(private readonly planVerifier: ValidatedOperationPlanVerifier) {}
  issue<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>, acquiredAt: number): ParticipantQueueLease {
    if (!this.planVerifier.verify(plan)) throw new TypeError("Queue lease requires a runtime-validated operation plan");
    const participantRepoIds = Object.freeze([...plan.requiredLocks.repositoryIds]);
    const familyIds = Object.freeze([...plan.requiredLocks.familyIds]);
    const acquisitionOrder: readonly RequiredOperationLock[] = Object.freeze(plan.requiredLocks.acquisitionOrder.map((lock) =>
      lock.kind === "repository" ? Object.freeze({ kind: "repository" as const, repoId: lock.repoId }) : Object.freeze({ kind: "family" as const, familyId: lock.familyId })
    ));
    const lockKeys = acquisitionOrder.map((lock) => lock.kind === "repository" ? `repository:${lock.repoId}` : `family:${lock.familyId}`);
    if (lockKeys.some((key) => this.#activeLockKeys.has(key))) throw new TypeError("Participant or repository-family queue lease overlaps an active operation");
    lockKeys.forEach((key) => this.#activeLockKeys.add(key));
    const lease = new ParticipantQueueLease(queueLeaseToken, plan.planIdentity, plan.planDigest, participantRepoIds, familyIds, acquisitionOrder, acquiredAt);
    queueLeaseIssuers.set(lease, { issuerId: this.#issuerId, lockKeys, active: true });
    return lease;
  }
  verifyActive<Id extends RepositoryId, Kind extends OperationKind>(candidate: unknown, plan: ValidatedOperationPlan<Id, Kind>): candidate is ParticipantQueueLease {
    if (!(candidate instanceof ParticipantQueueLease)) return false;
    const state = queueLeaseIssuers.get(candidate);
    if (state?.issuerId !== this.#issuerId || !state.active) return false;
    const lockOrderMatches = candidate.acquisitionOrder.length === plan.requiredLocks.acquisitionOrder.length
      && candidate.acquisitionOrder.every((lock, index) => equalRequiredLock(lock, plan.requiredLocks.acquisitionOrder[index]));
    return candidate.planIdentity === plan.planIdentity && candidate.planDigest === plan.planDigest && candidate.participantRepoIds.length === plan.requiredLocks.repositoryIds.length && candidate.participantRepoIds.every((repoId, index) => repoId === plan.requiredLocks.repositoryIds[index]) && candidate.repositoryFamilyIds.length === plan.requiredLocks.familyIds.length && candidate.repositoryFamilyIds.every((familyId, index) => familyId === plan.requiredLocks.familyIds[index]) && lockOrderMatches;
  }
  release(candidate: ParticipantQueueLease): void {
    const state = queueLeaseIssuers.get(candidate);
    if (state?.issuerId !== this.#issuerId || !state.active) throw new TypeError("Queue lease is not active for this authority");
    state.active = false;
    state.lockKeys.forEach((key) => this.#activeLockKeys.delete(key));
  }
}

export class AuthorizedGitOperation<Id extends RepositoryId = RepositoryId, Kind extends OperationKind = OperationKind> {
  declare private readonly runtimeCapability: typeof authorizedToken;
  constructor(token: typeof authorizedToken, readonly plan: ValidatedOperationPlan<Id, Kind>, readonly boundaryPermit: RepositoryBoundaryPermit, readonly executionPermit: GitExecutionPermit, readonly queueLease: ParticipantQueueLease) {
    if (token !== authorizedToken) throw new TypeError("AuthorizedGitOperation must be issued by its runtime authority");
    Object.freeze(this);
  }
}

export interface AuthorizedGitOperationVerifier {
  verifyFor<Id extends RepositoryId, Kind extends OperationKind>(candidate: unknown, expectedRepoId: Id, expectedKind: Kind): candidate is AuthorizedGitOperation<Id, Kind>;
}

export class RuntimeAuthorizedGitOperationAuthority implements AuthorizedGitOperationVerifier {
  readonly #issuerId = Symbol("authorized-git-operation-issuer");
  constructor(private readonly planAuthority: ValidatedOperationPlanVerifier, private readonly boundaryAuthority: RuntimeRepositoryBoundaryPermitAuthority, private readonly executionAuthority: RuntimeGitExecutionPermitAuthority, private readonly queueLeaseAuthority: RuntimeParticipantQueueLeaseAuthority) {}
  issue<Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>, boundaryPermit: RepositoryBoundaryPermit, executionPermit: GitExecutionPermit, queueLease: ParticipantQueueLease): AuthorizedGitOperation<Id, Kind> {
    if (!this.planAuthority.verify(plan) || !this.boundaryAuthority.verify(boundaryPermit, plan) || !this.executionAuthority.verify(executionPermit, plan) || !this.queueLeaseAuthority.verifyActive(queueLease, plan)) throw new TypeError("Authorization evidence does not match the validated plan");
    const authorized = new AuthorizedGitOperation(authorizedToken, plan, boundaryPermit, executionPermit, queueLease);
    authorizedIssuers.set(authorized, this.#issuerId);
    return authorized;
  }
  verifyFor<Id extends RepositoryId, Kind extends OperationKind>(candidate: unknown, expectedRepoId: Id, expectedKind: Kind): candidate is AuthorizedGitOperation<Id, Kind> {
    return candidate instanceof AuthorizedGitOperation && authorizedIssuers.get(candidate) === this.#issuerId && this.planAuthority.verify(candidate.plan) && candidate.plan.repoId === expectedRepoId && candidate.plan.kind === expectedKind && this.boundaryAuthority.verify(candidate.boundaryPermit, candidate.plan) && this.executionAuthority.verify(candidate.executionPermit, candidate.plan) && this.queueLeaseAuthority.verifyActive(candidate.queueLease, candidate.plan);
  }
}
