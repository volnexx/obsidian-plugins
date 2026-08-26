import type { AuthorizedGitOperation, ParticipantQueueLease } from "../authorization/OperationAuthorization";
import type { RuntimeAuthorizedGitOperationAuthority, RuntimeParticipantQueueLeaseAuthority } from "../authorization/OperationAuthorization";
import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryFamilyId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";
import type { RepositoryBoundaryPolicy } from "../core/RepositoryBoundaryPolicy";
import type { GitExecutionPolicy } from "../git/GitExecutionPolicy";
import type { OperationQueue, OperationQueueLease } from "./OperationQueue";

/**
 * Acquires every participant repository and repository-family lock in one canonical order.
 * Implementations MUST use sorted RepositoryId/family keys, invoke work only after all leases
 * are held, and release every acquired lease in finally (including partial acquisition failure).
 */
export interface CrossContextOperationCoordinator {
  withParticipantQueues<Result, Id extends RepositoryId, Kind extends OperationKind>(
    plan: ValidatedOperationPlan<Id, Kind>,
    execute: (lease: ParticipantQueueLease) => Promise<Result>
  ): Promise<Result>;
}

/**
 * Sole gate from validated planning to backend execution. It verifies plan provenance, obtains
 * boundary and Git-execution permits, acquires participant queues, then issues the authorized
 * envelope for the active lease. The envelope becomes invalid when the callback finishes.
 */
export interface GitOperationExecutionCoordinator {
  execute<Result, Id extends RepositoryId, Kind extends OperationKind>(
    plan: ValidatedOperationPlan<Id, Kind>,
    invokeBackend: (operation: AuthorizedGitOperation<Id, Kind>) => Promise<Result>
  ): Promise<Result>;
}

class FamilyLock {
  #tail: Promise<void> = Promise.resolve();

  async acquire(signal: AbortSignal, deadlineAt: number): Promise<OperationQueueLease> {
    if (signal.aborted) throw new DOMException("Family lock acquisition cancelled", "AbortError");
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const previous = this.#tail;
    this.#tail = previous.then(() => gate);
    let rejectWaiting: (reason: Error) => void = () => undefined;
    const waiting = new Promise<never>((_resolve, reject) => { rejectWaiting = reject; });
    const abortListener = (): void => rejectWaiting(new DOMException("Family lock acquisition cancelled", "AbortError"));
    const timer = setTimeout(() => rejectWaiting(new Error("Family lock acquisition deadline elapsed")), Math.max(0, deadlineAt - Date.now()));
    signal.addEventListener("abort", abortListener, { once: true });
    try { await Promise.race([previous, waiting]); }
    catch (error) { releaseGate(); throw error; }
    finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abortListener);
    }
    let active = true;
    return Object.freeze({ release: (): void => {
      if (!active) throw new TypeError("Family lock already released");
      active = false;
      releaseGate();
    } });
  }
}

export class RuntimeCrossContextOperationCoordinator implements CrossContextOperationCoordinator {
  readonly #familyLocks = new Map<RepositoryFamilyId, FamilyLock>();

  constructor(private readonly queueFor: (repoId: RepositoryId) => OperationQueue, private readonly leaseAuthority: RuntimeParticipantQueueLeaseAuthority) {}

  async withParticipantQueues<Result, Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>, execute: (lease: ParticipantQueueLease) => Promise<Result>): Promise<Result> {
    const acquired: OperationQueueLease[] = [];
    let participantLease: ParticipantQueueLease | null = null;
    try {
      for (const lock of plan.requiredLocks.acquisitionOrder) {
        const lease = lock.kind === "repository"
          ? await this.queueFor(lock.repoId).acquire(plan.signal, plan.deadlineAt)
          : await this.#familyLock(lock.familyId).acquire(plan.signal, plan.deadlineAt);
        acquired.push(lease);
      }
      participantLease = this.leaseAuthority.issue(plan, Date.now());
      return await execute(participantLease);
    } finally {
      if (participantLease !== null) this.leaseAuthority.release(participantLease);
      for (const lease of acquired.reverse()) lease.release();
    }
  }

  #familyLock(familyId: RepositoryFamilyId): FamilyLock {
    const existing = this.#familyLocks.get(familyId);
    if (existing !== undefined) return existing;
    const created = new FamilyLock();
    this.#familyLocks.set(familyId, created);
    return created;
  }
}

export class RuntimeGitOperationExecutionCoordinator implements GitOperationExecutionCoordinator {
  constructor(
    private readonly boundaryPolicy: RepositoryBoundaryPolicy,
    private readonly executionPolicy: GitExecutionPolicy,
    private readonly queueCoordinator: CrossContextOperationCoordinator,
    private readonly authorizedAuthority: RuntimeAuthorizedGitOperationAuthority
  ) {}

  async execute<Result, Id extends RepositoryId, Kind extends OperationKind>(plan: ValidatedOperationPlan<Id, Kind>, invokeBackend: (operation: AuthorizedGitOperation<Id, Kind>) => Promise<Result>): Promise<Result> {
    const boundary = this.boundaryPolicy.authorize(plan);
    if (!boundary.allowed) throw new TypeError(`Repository boundary authorization denied: ${boundary.reason}`);
    const execution = this.executionPolicy.authorize(plan);
    if (!execution.allowed) throw new TypeError(`Git execution authorization denied: ${execution.reason}`);
    return this.queueCoordinator.withParticipantQueues(plan, async (queueLease) => {
      const authorized = this.authorizedAuthority.issue(plan, boundary.permit, execution.permit, queueLease);
      return invokeBackend(authorized);
    });
  }
}
