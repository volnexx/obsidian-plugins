import { randomUUID } from "node:crypto";

import type { RepositoryDiagnosticReadModel, RepositoryRefreshResult } from "../public/PublicReadModels";
import type { CancelRepositoryOperationRequest, RepositoryCommandRequest, RepositoryController } from "../public/RepositoryController";
import type { RuntimeRepositoryRegistry } from "../../core/RepositoryRegistry";
import type { OperationIntent } from "../../domain/OperationTypes";
import type { OperationId, RepositoryId } from "../../domain/RepositoryId";
import type { GitOperationExecutionCoordinator } from "../../operations/CrossContextOperationCoordinator";
import type { OperationPlanner } from "../../operations/OperationPlanner";

export class RuntimeRepositoryController implements RepositoryController {
  readonly #controllers = new Map<OperationId, AbortController>();

  constructor(private readonly registry: RuntimeRepositoryRegistry, private readonly planner: OperationPlanner, private readonly execution: GitOperationExecutionCoordinator, private readonly clock: () => number = Date.now) {}

  async refresh<Id extends RepositoryId>(request: RepositoryCommandRequest<Id>): Promise<void> {
    const context = this.registry.getRequired(request.repoId);
    const operationId = randomUUID() as OperationId;
    const abortController = new AbortController();
    this.#controllers.set(operationId, abortController);
    const intent: OperationIntent<Id, "status"> = { repoId: request.repoId, operationId, kind: "status", payload: {}, origin: "user", signal: abortController.signal, deadlineAt: this.clock() + 30_000 };
    const plan = await this.planner.plan(intent);
    context.store.beginOperation({ plan, startedAt: this.clock(), progress: null });
    try {
      const observation = await this.execution.execute(plan, (authorized) => context.backend.status(authorized));
      context.store.applyObservation(observation);
      context.store.finishOperation();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "repository-missing") this.registry.markMissing(context.id);
      context.store.fail({ code: error instanceof Error && "code" in error ? String(error.code) : "status-failed", message: error instanceof Error ? error.message : String(error), operationId });
      throw error;
    } finally {
      this.#controllers.delete(operationId);
    }
  }

  async refreshAll(): Promise<readonly RepositoryRefreshResult[]> {
    const contexts = this.registry.list();
    const results = await Promise.all(contexts.map(async (context): Promise<RepositoryRefreshResult> => {
      try { await this.refresh({ repoId: context.id }); return { repositoryId: context.id, ok: true, error: null }; }
      catch (error) { return { repositoryId: context.id, ok: false, error: error instanceof Error ? error.message : String(error) }; }
    }));
    return Object.freeze(results);
  }

  list(): readonly RepositoryDiagnosticReadModel[] {
    return Object.freeze(this.registry.list().map((context) => {
      const snapshot = context.store.snapshot?.observation;
      const files = snapshot?.files ?? [];
      return Object.freeze({
        repositoryId: context.id,
        displayPath: context.descriptor.displayPath,
        rootPath: context.descriptor.runtimeRoot,
        branch: snapshot?.branch.head ?? (snapshot?.branch.detached === true ? "(detached)" : "(unknown)"),
        detached: snapshot?.branch.detached ?? false,
        upstream: snapshot?.branch.upstream ?? null,
        ahead: snapshot?.branch.ahead ?? 0,
        behind: snapshot?.branch.behind ?? 0,
        staged: files.filter((file) => file.indexStatus !== "unmodified").length,
        unstaged: files.filter((file) => file.worktreeStatus !== "unmodified").length,
        untracked: files.filter((file) => file.untracked).length,
        conflicts: files.filter((file) => file.changeKind === "unmerged").length,
        lifecycle: context.store.lifecycle,
        error: context.store.lastError?.message ?? null
      });
    }));
  }

  cancel<Id extends RepositoryId>(request: CancelRepositoryOperationRequest<Id>): boolean {
    const controller = this.#controllers.get(request.operationId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }
}
