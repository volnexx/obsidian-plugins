import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryLifecycle } from "../domain/RepositoryDescriptor";
import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryObservation } from "../domain/RepositorySnapshot";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";

export type RepositoryStateConfidence = "authoritative" | "stale" | "unknown";

export interface StoredRepositorySnapshot<Id extends RepositoryId = RepositoryId> {
  readonly observation: RepositoryObservation<Id>;
  readonly generation: number;
  readonly confidence: RepositoryStateConfidence;
  readonly appliedAt: number;
}

export interface RepositoryOperationState<
  Id extends RepositoryId = RepositoryId,
  Kind extends OperationKind = OperationKind
> {
  readonly plan: ValidatedOperationPlan<Id, Kind>;
  readonly startedAt: number;
  readonly progress: number | null;
}

export interface RepositoryErrorState<Id extends RepositoryId = RepositoryId> {
  readonly repoId: Id;
  readonly code: string;
  readonly message: string;
  readonly operationId: string | null;
  readonly occurredAt: number;
}

export interface RepoStore<Id extends RepositoryId = RepositoryId> {
  readonly repositoryId: Id;
  readonly lifecycle: RepositoryLifecycle;
  readonly snapshot: StoredRepositorySnapshot<Id> | null;
  readonly currentOperation: RepositoryOperationState<Id> | null;
  readonly lastError: RepositoryErrorState<Id> | null;

  applyObservation(observation: RepositoryObservation<Id>): boolean;
  markStale(repoId: Id): void;
  markUnknown(repoId: Id): void;
  markMissing(): void;
  markReady(): void;
  markDisposed(): void;
  beginOperation(operation: RepositoryOperationState<Id>): void;
  finishOperation(): void;
  fail(error: Omit<RepositoryErrorState<Id>, "repoId" | "occurredAt">): void;
}

export class RuntimeRepoStore<Id extends RepositoryId = RepositoryId> implements RepoStore<Id> {
  #lifecycle: RepositoryLifecycle = "ready";
  #snapshot: StoredRepositorySnapshot<Id> | null = null;
  #currentOperation: RepositoryOperationState<Id> | null = null;
  #lastError: RepositoryErrorState<Id> | null = null;

  constructor(readonly repositoryId: Id, private readonly clock: () => number = Date.now) {}

  get lifecycle(): RepositoryLifecycle { return this.#lifecycle; }
  get snapshot(): StoredRepositorySnapshot<Id> | null { return this.#snapshot; }
  get currentOperation(): RepositoryOperationState<Id> | null { return this.#currentOperation; }
  get lastError(): RepositoryErrorState<Id> | null { return this.#lastError; }

  applyObservation(observation: RepositoryObservation<Id>): boolean {
    if (observation.repositoryId !== this.repositoryId) throw new TypeError("Observation belongs to another repository");
    if (this.#snapshot !== null && observation.observedAt <= this.#snapshot.observation.observedAt) return false;
    this.#snapshot = Object.freeze({ observation, generation: (this.#snapshot?.generation ?? 0) + 1, confidence: "authoritative", appliedAt: this.clock() });
    this.#lifecycle = "ready";
    this.#lastError = null;
    return true;
  }

  markStale(repoId: Id): void {
    this.#assertRepo(repoId);
    if (this.#snapshot !== null) this.#snapshot = Object.freeze({ ...this.#snapshot, confidence: "stale" });
  }

  markUnknown(repoId: Id): void {
    this.#assertRepo(repoId);
    if (this.#snapshot !== null) this.#snapshot = Object.freeze({ ...this.#snapshot, confidence: "unknown" });
  }

  markMissing(): void { this.#lifecycle = "missing"; this.markUnknown(this.repositoryId); }
  markReady(): void { this.#lifecycle = "ready"; this.markStale(this.repositoryId); }
  markDisposed(): void { this.#lifecycle = "disposed"; this.#currentOperation = null; }
  beginOperation(operation: RepositoryOperationState<Id>): void { this.#currentOperation = operation; }
  finishOperation(): void { this.#currentOperation = null; }
  fail(error: Omit<RepositoryErrorState<Id>, "repoId" | "occurredAt">): void {
    this.#lastError = Object.freeze({ ...error, repoId: this.repositoryId, occurredAt: this.clock() });
    this.#currentOperation = null;
    this.markStale(this.repositoryId);
  }

  #assertRepo(repoId: Id): void { if (repoId !== this.repositoryId) throw new TypeError("RepoStore repository isolation violation"); }
}
