import type { OperationKind } from "../domain/OperationRequests";
import type { RepositoryId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";

export interface QueuedOperation<
  Id extends RepositoryId = RepositoryId,
  Kind extends OperationKind = OperationKind
> {
  readonly plan: ValidatedOperationPlan<Id, Kind>;
  readonly priority: "user" | "normal" | "background";
  readonly dedupeKey?: string;
  readonly enqueuedAt: number;
}

export interface OperationQueue<Id extends RepositoryId = RepositoryId> {
  readonly repositoryId: Id;

  acquire(signal: AbortSignal, deadlineAt: number): Promise<OperationQueueLease>;

  enqueue<Result, Kind extends OperationKind>(
    operation: QueuedOperation<Id, Kind>,
    execute: (plan: ValidatedOperationPlan<Id, Kind>) => Promise<Result>
  ): Promise<Result>;

  cancel(operationId: string): boolean;
  dispose(repoId: Id): Promise<void>;
}

export interface OperationQueueLease { release(): void; }

interface Waiter {
  readonly resolve: (lease: OperationQueueLease) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  abortListener: (() => void) | null;
}

export class RuntimeOperationQueue<Id extends RepositoryId = RepositoryId> implements OperationQueue<Id> {
  readonly #waiters: Waiter[] = [];
  #locked = false;
  #disposed = false;

  constructor(readonly repositoryId: Id) {}

  acquire(signal: AbortSignal, deadlineAt: number): Promise<OperationQueueLease> {
    if (this.#disposed) return Promise.reject(new Error(`Repository queue ${this.repositoryId} is disposed`));
    if (signal.aborted) return Promise.reject(new DOMException("Queue acquisition cancelled", "AbortError"));
    if (deadlineAt <= Date.now()) return Promise.reject(new Error("Queue acquisition deadline elapsed"));
    if (!this.#locked && this.#waiters.length === 0) {
      this.#locked = true;
      return Promise.resolve(this.#lease());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal, deadlineAt, timer: null, abortListener: null };
      const remove = (error: Error): void => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        this.#cleanup(waiter);
        reject(error);
      };
      waiter.abortListener = () => remove(new DOMException("Queue acquisition cancelled", "AbortError"));
      waiter.timer = setTimeout(() => remove(new Error("Queue acquisition deadline elapsed")), Math.max(0, deadlineAt - Date.now()));
      signal.addEventListener("abort", waiter.abortListener, { once: true });
      this.#waiters.push(waiter);
    });
  }

  async enqueue<Result, Kind extends OperationKind>(operation: QueuedOperation<Id, Kind>, execute: (plan: ValidatedOperationPlan<Id, Kind>) => Promise<Result>): Promise<Result> {
    const lease = await this.acquire(operation.plan.signal, operation.plan.deadlineAt);
    try { return await execute(operation.plan); }
    finally { lease.release(); }
  }

  cancel(): boolean { return false; }

  async dispose(repoId: Id): Promise<void> {
    if (repoId !== this.repositoryId) throw new TypeError("Cannot dispose a queue through another repository context");
    this.#disposed = true;
    for (const waiter of this.#waiters.splice(0)) {
      this.#cleanup(waiter);
      waiter.reject(new Error(`Repository queue ${this.repositoryId} was disposed`));
    }
    await Promise.resolve();
  }

  #lease(): OperationQueueLease {
    let active = true;
    return Object.freeze({ release: (): void => {
      if (!active) throw new TypeError("Operation queue lease already released");
      active = false;
      this.#advance();
    } });
  }

  #advance(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (waiter === undefined) break;
      this.#cleanup(waiter);
      if (waiter.signal.aborted || waiter.deadlineAt <= Date.now()) {
        waiter.reject(waiter.signal.aborted ? new DOMException("Queue acquisition cancelled", "AbortError") : new Error("Queue acquisition deadline elapsed"));
        continue;
      }
      waiter.resolve(this.#lease());
      return;
    }
    this.#locked = false;
  }

  #cleanup(waiter: Waiter): void {
    if (waiter.timer !== null) clearTimeout(waiter.timer);
    if (waiter.abortListener !== null) waiter.signal.removeEventListener("abort", waiter.abortListener);
  }
}
