import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryProbeResult } from "../domain/RepositoryProbe";
import type { AuthorizedGitOperationVerifier } from "../authorization/OperationAuthorization";
import type { RepositoryDescriptor } from "../domain/RepositoryDescriptor";
import { DesktopGitBackend } from "../git/infrastructure/DesktopGitBackend";
import type { DesktopGitCommandRunner } from "../git/infrastructure/GitCommandRunner";
import { RuntimeOperationQueue } from "../operations/OperationQueue";
import type { RepositorySafetyFacade } from "../safety/RepositorySafetyFacade";
import { RuntimeRepoStore } from "../state/RepoStore";
import type { ProvisionalRepositoryContext } from "./ProvisionalRepositoryContext";
import type { RepositoryContext } from "./RepositoryContext";

export interface RepositoryContextFactory {
  finalize<Id extends RepositoryId>(
    provisional: ProvisionalRepositoryContext<Id>,
    probeResult: RepositoryProbeResult<Id>
  ): RepositoryContext<Id>;
}

export class RuntimeRepositoryContextFactory implements RepositoryContextFactory {
  constructor(
    private readonly runner: DesktopGitCommandRunner,
    private readonly authorizationVerifier: AuthorizedGitOperationVerifier,
    private readonly safetyFactory: <Id extends RepositoryId>(repoId: Id) => RepositorySafetyFacade<Id>,
    private readonly clock: () => number = Date.now
  ) {}

  finalize<Id extends RepositoryId>(provisional: ProvisionalRepositoryContext<Id>, probeResult: RepositoryProbeResult<Id>): RepositoryContext<Id> {
    if (provisional.id !== probeResult.repoId || provisional.target.candidateRoot !== probeResult.target.candidateRoot || provisional.target.locator.kind !== probeResult.target.locator.kind) {
      throw new TypeError("Probe result does not belong to provisional context");
    }
    const descriptor: RepositoryDescriptor<Id> = Object.freeze({
      repositoryId: provisional.id,
      familyId: probeResult.familyId,
      name: provisional.target.displayPath.split("/").at(-1) ?? provisional.id,
      locator: Object.freeze({ ...provisional.target.locator }),
      runtimeRoot: probeResult.runtimeRoot,
      displayPath: provisional.target.displayPath,
      gitDir: probeResult.gitDir,
      commonDir: probeResult.commonDir,
      superprojectRoot: probeResult.superprojectRoot,
      objectFormat: probeResult.objectFormat,
      aliases: Object.freeze([])
    });
    return Object.freeze({
      id: provisional.id,
      descriptor,
      backend: new DesktopGitBackend(descriptor, this.runner, this.authorizationVerifier),
      store: new RuntimeRepoStore(provisional.id, this.clock),
      queue: new RuntimeOperationQueue(provisional.id),
      safety: this.safetyFactory(provisional.id),
      metadata: Object.freeze({ discoveredAt: this.clock(), source: provisional.target.locator.kind === "external" ? "external" : provisional.target.locator.kind === "submodule" ? "submodule" : "vault-plugin", trust: "untrusted" })
    });
  }
}
