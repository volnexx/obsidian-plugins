import { FileSystemAdapter, Notice, type Plugin } from "obsidian";

import { RuntimeRepositoryController } from "../application/internal/RuntimeRepositoryController";
import { RuntimeAuthorizedGitOperationAuthority, RuntimeGitExecutionPermitAuthority, RuntimeParticipantQueueLeaseAuthority, RuntimeRepositoryBoundaryPermitAuthority } from "../authorization/OperationAuthorization";
import { ReadOnlyRepositoryBoundaryPolicy } from "../core/ReadOnlyRepositoryBoundaryPolicy";
import { RuntimeRepositoryContextFactory } from "../core/RepositoryContextFactory";
import { RuntimeRepositoryRegistry } from "../core/RepositoryRegistry";
import { RuntimeRepositoryRelationGraph } from "../core/RepositoryRelationGraph";
import type { RepositoryId } from "../domain/RepositoryId";
import { DesktopRepositoryDiscovery } from "../git/infrastructure/DesktopRepositoryDiscovery";
import { GitCapabilityService } from "../git/infrastructure/GitCapabilityService";
import { DesktopGitCommandRunner } from "../git/infrastructure/GitCommandRunner";
import { ReadOnlyGitExecutionPolicy } from "../git/infrastructure/ReadOnlyGitExecutionPolicy";
import { PersistentRepositoryIdentityStore, type PersistedRepositoryIdentityData } from "../git/infrastructure/RepositoryIdentityStore";
import { RuntimeCrossContextOperationCoordinator, RuntimeGitOperationExecutionCoordinator } from "../operations/CrossContextOperationCoordinator";
import { RuntimeOperationPlanner } from "../operations/RuntimeOperationPlanner";
import { StageTwoUnavailableSafetyFacade } from "../safety/StageTwoUnavailableSafetyFacade";
import { RepositoryDiagnosticsModal } from "../ui/RepositoryDiagnosticsModal";

type StageTwoPluginData = PersistedRepositoryIdentityData;

export class PluginRuntime {
  private constructor(private readonly plugin: Plugin, private readonly registry: RuntimeRepositoryRegistry, private readonly controller: RuntimeRepositoryController, readonly gitVersion: string) {}

  static async create(plugin: Plugin): Promise<PluginRuntime> {
    const adapter = plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new TypeError("Stage 2 desktop Git requires a filesystem-backed Obsidian vault");
    const runner = new DesktopGitCommandRunner();
    const gitVersion = await new GitCapabilityService(runner).check();
    const relationGraph = new RuntimeRepositoryRelationGraph();
    const planner = new RuntimeOperationPlanner({ family: (repoId) => {
      const family = relationGraph.family(repoId);
      return family === null ? null : { familyId: family.id, memberCount: family.members.length };
    } });
    const boundaryPermitAuthority = new RuntimeRepositoryBoundaryPermitAuthority();
    const executionPermitAuthority = new RuntimeGitExecutionPermitAuthority();
    const participantLeaseAuthority = new RuntimeParticipantQueueLeaseAuthority(planner.authority);
    const authorizedAuthority = new RuntimeAuthorizedGitOperationAuthority(planner.authority, boundaryPermitAuthority, executionPermitAuthority, participantLeaseAuthority);
    const contextFactory = new RuntimeRepositoryContextFactory(runner, authorizedAuthority, <Id extends RepositoryId>(repoId: Id) => new StageTwoUnavailableSafetyFacade(repoId));
    const registry = new RuntimeRepositoryRegistry(contextFactory);
    const loaded = await plugin.loadData() as StageTwoPluginData | null;
    const identityStore = new PersistentRepositoryIdentityStore(loaded ?? undefined, async (data) => plugin.saveData(data));
    const discovery = new DesktopRepositoryDiscovery({
      vaultRoot: adapter.getBasePath(), configDir: plugin.app.vault.configDir, identityStore, registry, relationGraph,
      planner, planVerifier: planner.authority, runner
    });
    const report = await discovery.discover(new AbortController().signal);
    const boundaryPolicy = new ReadOnlyRepositoryBoundaryPolicy(planner.authority, boundaryPermitAuthority);
    const executionPolicy = new ReadOnlyGitExecutionPolicy(planner.authority, (repoId) => registry.getRequired(repoId).metadata.trust, executionPermitAuthority);
    const queueCoordinator = new RuntimeCrossContextOperationCoordinator((repoId) => registry.getRequired(repoId).queue, participantLeaseAuthority);
    const executionCoordinator = new RuntimeGitOperationExecutionCoordinator(boundaryPolicy, executionPolicy, queueCoordinator, authorizedAuthority);
    const controller = new RuntimeRepositoryController(registry, planner, executionCoordinator);
    const accepted = report.entries.filter((entry) => entry.result === "accepted").length;
    const rejected = report.entries.length - accepted;
    new Notice(`Git ${gitVersion}: ${accepted} repositories discovered${rejected === 0 ? "" : `, ${rejected} rejected`}`);
    return new PluginRuntime(plugin, registry, controller, gitVersion);
  }

  showRepositories(): void { new RepositoryDiagnosticsModal(this.plugin.app, this.controller).open(); }

  async dispose(): Promise<void> {
    const ids = this.registry.records().flatMap((record) => record.lifecycle === "ready" || record.lifecycle === "missing" ? [record.context.id] : []);
    await Promise.all(ids.map((repoId) => this.registry.dispose(repoId)));
  }
}
