import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";

import type { ProvisionalRepositoryContext } from "../../core/ProvisionalRepositoryContext";
import type { RepositoryDiscovery, RepositoryDiscoveryEntry, RepositoryDiscoveryReport, RepositoryIdentityStore } from "../../core/RepositoryDiscovery";
import type { RuntimeRepositoryRegistry } from "../../core/RepositoryRegistry";
import type { RuntimeRepositoryRelationGraph } from "../../core/RepositoryRelationGraph";
import type { OperationIntent } from "../../domain/OperationTypes";
import type { CanonicalAbsolutePath, VaultRelativePath } from "../../domain/RepoRelativePath";
import type { OperationId, RepositoryId } from "../../domain/RepositoryId";
import type { RepositoryLocator } from "../../domain/RepositoryLocator";
import { GitRuntimeError } from "../GitErrors";
import type { OperationPlanner } from "../../operations/OperationPlanner";
import { canonicalizeExistingPath } from "./CanonicalPath";
import type { DesktopGitCommandRunner } from "./GitCommandRunner";
import { DesktopRepositoryProbeBackend } from "./DesktopRepositoryProbeBackend";
import type { ValidatedOperationPlanVerifier } from "../../domain/ValidatedOperationPlan";

export interface DesktopRepositoryDiscoveryOptions {
  readonly vaultRoot: string;
  readonly configDir: string;
  readonly identityStore: RepositoryIdentityStore;
  readonly registry: RuntimeRepositoryRegistry;
  readonly relationGraph: RuntimeRepositoryRelationGraph;
  readonly planner: OperationPlanner;
  readonly planVerifier: ValidatedOperationPlanVerifier;
  readonly runner: DesktopGitCommandRunner;
  readonly clock?: () => number;
}

export class DesktopRepositoryDiscovery implements RepositoryDiscovery {
  readonly #clock: () => number;
  constructor(private readonly options: DesktopRepositoryDiscoveryOptions) { this.#clock = options.clock ?? Date.now; }

  async discover(signal: AbortSignal): Promise<RepositoryDiscoveryReport> {
    const startedAt = this.#clock();
    const pluginsRoot = join(this.options.vaultRoot, this.options.configDir, "plugins");
    const directoryEntries = (await readdir(pluginsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name));
    const reportEntries: RepositoryDiscoveryEntry[] = [];
    const roots = new Set<CanonicalAbsolutePath>();
    for (const entry of directoryEntries) {
      if (signal.aborted) throw new DOMException("Repository discovery cancelled", "AbortError");
      const candidateRoot = await canonicalizeExistingPath(join(pluginsRoot, entry.name));
      const relativePath = posix.join(this.options.configDir.replaceAll("\\", "/"), "plugins", entry.name) as VaultRelativePath;
      const locator: RepositoryLocator = Object.freeze({ kind: "vault-relative", relativePath });
      const repoId = await this.options.identityStore.getOrCreate(locator);
      const displayPath = relativePath;
      const target = Object.freeze({ repoId, locator, candidateRoot, displayPath });
      const probeBackend = new DesktopRepositoryProbeBackend(target, this.options.runner, this.options.planVerifier);
      const provisional: ProvisionalRepositoryContext = Object.freeze({ id: repoId, lifecycle: "probing", target, probeBackend });
      this.options.registry.registerProvisional(provisional);
      const intent: OperationIntent<RepositoryId, "probe"> = { repoId, operationId: randomUUID() as OperationId, kind: "probe", payload: {}, origin: "system", signal, deadlineAt: this.#clock() + 30_000 };
      try {
        const plan = await this.options.planner.plan(intent);
        const result = await probeBackend.probe(plan);
        if (roots.has(result.runtimeRoot)) {
          reportEntries.push(Object.freeze({ repoId, displayPath, candidateRoot, result: "duplicate", runtimeRoot: result.runtimeRoot, errorCode: "duplicate-root", message: "Canonical repository root was already discovered" }));
          await this.options.registry.dispose(repoId);
          continue;
        }
        roots.add(result.runtimeRoot);
        this.options.registry.finalize(repoId, result);
        reportEntries.push(Object.freeze({ repoId, displayPath, candidateRoot, result: "accepted", runtimeRoot: result.runtimeRoot, errorCode: null, message: null }));
      } catch (error) {
        const code = error instanceof GitRuntimeError ? error.code : "probe-failed";
        reportEntries.push(Object.freeze({ repoId, displayPath, candidateRoot, result: "rejected", runtimeRoot: null, errorCode: code, message: error instanceof Error ? error.message : String(error) }));
        await this.options.registry.dispose(repoId);
      }
    }
    this.options.relationGraph.replace(this.options.registry.list().map((context) => context.descriptor));
    return Object.freeze({ pluginsRoot, startedAt, completedAt: this.#clock(), entries: Object.freeze(reportEntries) });
  }
}
