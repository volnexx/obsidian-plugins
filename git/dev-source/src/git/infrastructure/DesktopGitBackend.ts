import type { AuthorizedGitOperation, AuthorizedGitOperationVerifier } from "../../authorization/OperationAuthorization";
import type { RepositoryDescriptor } from "../../domain/RepositoryDescriptor";
import type { RepositoryId } from "../../domain/RepositoryId";
import type { RepositoryObservation } from "../../domain/RepositorySnapshot";
import type { GitBackend } from "../GitBackend";
import type { DesktopGitCommandRunner } from "./GitCommandRunner";
import { parsePorcelainV2Status } from "./PorcelainV2Parser";

export class DesktopGitBackend<Id extends RepositoryId = RepositoryId> implements GitBackend<Id> {
  #lastObservedAt = 0;
  readonly runtime = "desktop-system-git" as const;
  readonly repositoryId: Id;
  readonly descriptor: RepositoryDescriptor<Id>;

  constructor(descriptor: RepositoryDescriptor<Id>, private readonly runner: DesktopGitCommandRunner, private readonly authorizationVerifier: AuthorizedGitOperationVerifier) {
    this.repositoryId = descriptor.repositoryId;
    this.descriptor = descriptor;
    Object.freeze(this);
  }

  async status(operation: AuthorizedGitOperation<Id, "status">): Promise<RepositoryObservation<Id>> {
    if (!this.authorizationVerifier.verifyFor(operation, this.repositoryId, "status")) throw new TypeError("Status operation is not authorized for this backend target");
    const result = await this.runner.runStatus(this.descriptor, operation.plan.operationId, operation.plan.signal, operation.plan.deadlineAt);
    this.#lastObservedAt = Math.max(Date.now(), this.#lastObservedAt + 1);
    return parsePorcelainV2Status(this.repositoryId, result.stdout, this.#lastObservedAt, { repositoryId: this.repositoryId, operationId: operation.plan.operationId, command: "status" });
  }
}
