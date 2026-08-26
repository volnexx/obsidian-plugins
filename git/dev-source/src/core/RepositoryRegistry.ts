import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryContext } from "./RepositoryContext";
import type { ProvisionalRepositoryContext } from "./ProvisionalRepositoryContext";
import type { RepositoryContextFactory } from "./RepositoryContextFactory";
import type { RepositoryProbeResult } from "../domain/RepositoryProbe";

export type RepositoryRegistryEvent =
  | { readonly kind: "added"; readonly repoId: RepositoryId }
  | { readonly kind: "missing"; readonly repoId: RepositoryId }
  | { readonly kind: "returned"; readonly repoId: RepositoryId }
  | { readonly kind: "removed"; readonly repoId: RepositoryId };

export interface RepositoryRegistry {
  get<Id extends RepositoryId>(repoId: Id): RepositoryContext<Id> | undefined;
  getRequired<Id extends RepositoryId>(repoId: Id): RepositoryContext<Id>;
  list(): readonly RepositoryContext[];
  subscribe(listener: (event: RepositoryRegistryEvent) => void): () => void;
}

export type RepositoryRegistryRecord =
  | { readonly lifecycle: "provisional"; readonly provisional: ProvisionalRepositoryContext }
  | { readonly lifecycle: "ready"; readonly context: RepositoryContext }
  | { readonly lifecycle: "missing"; readonly context: RepositoryContext }
  | { readonly lifecycle: "disposed"; readonly repoId: RepositoryId };

export class RuntimeRepositoryRegistry implements RepositoryRegistry {
  readonly #records = new Map<RepositoryId, RepositoryRegistryRecord>();
  readonly #listeners = new Set<(event: RepositoryRegistryEvent) => void>();

  constructor(private readonly factory: RepositoryContextFactory) {}

  registerProvisional(context: ProvisionalRepositoryContext): void {
    if (this.#records.has(context.id)) throw new TypeError(`Repository ${context.id} is already registered`);
    this.#records.set(context.id, Object.freeze({ lifecycle: "provisional", provisional: context }));
  }

  finalize<Id extends RepositoryId>(repoId: Id, result: RepositoryProbeResult<Id>): RepositoryContext<Id> {
    const record = this.#records.get(repoId);
    if (record?.lifecycle !== "provisional") throw new TypeError(`Repository ${repoId} is not provisional`);
    const context = this.factory.finalize(record.provisional as ProvisionalRepositoryContext<Id>, result);
    this.#records.set(repoId, Object.freeze({ lifecycle: "ready", context }));
    this.#emit({ kind: "added", repoId });
    return context;
  }

  get<Id extends RepositoryId>(repoId: Id): RepositoryContext<Id> | undefined {
    const record = this.#records.get(repoId);
    return record?.lifecycle === "ready" ? record.context as RepositoryContext<Id> : undefined;
  }

  getRequired<Id extends RepositoryId>(repoId: Id): RepositoryContext<Id> {
    const context = this.get(repoId);
    if (context === undefined) throw new TypeError(`Repository ${repoId} is not ready`);
    return context;
  }

  list(): readonly RepositoryContext[] {
    return Object.freeze([...this.#records.values()].flatMap((record) => record.lifecycle === "ready" || record.lifecycle === "missing" ? [record.context] : []).sort((left, right) => left.id.localeCompare(right.id)));
  }

  records(): readonly RepositoryRegistryRecord[] { return Object.freeze([...this.#records.values()]); }

  markMissing(repoId: RepositoryId): void {
    const record = this.#records.get(repoId);
    if (record?.lifecycle !== "ready") return;
    record.context.store.markMissing();
    this.#records.set(repoId, Object.freeze({ lifecycle: "missing", context: record.context }));
    this.#emit({ kind: "missing", repoId });
  }

  restore(repoId: RepositoryId): void {
    const record = this.#records.get(repoId);
    if (record?.lifecycle !== "missing") return;
    record.context.store.markReady();
    this.#records.set(repoId, Object.freeze({ lifecycle: "ready", context: record.context }));
    this.#emit({ kind: "returned", repoId });
  }

  async dispose(repoId: RepositoryId): Promise<void> {
    const record = this.#records.get(repoId);
    if (record === undefined || record.lifecycle === "disposed") return;
    if (record.lifecycle === "ready" || record.lifecycle === "missing") {
      await record.context.queue.dispose(record.context.id);
      record.context.store.markDisposed();
    }
    this.#records.set(repoId, Object.freeze({ lifecycle: "disposed", repoId }));
    this.#emit({ kind: "removed", repoId });
  }

  subscribe(listener: (event: RepositoryRegistryEvent) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #emit(event: RepositoryRegistryEvent): void { for (const listener of this.#listeners) listener(event); }
}
