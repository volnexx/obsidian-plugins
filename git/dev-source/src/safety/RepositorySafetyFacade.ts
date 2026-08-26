import type { DestructiveOperationKind } from "../domain/OperationTypes";
import type { RepositoryId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";

export interface RepositorySafetyFacade<Id extends RepositoryId = RepositoryId> {
  readonly repositoryId: Id;
  execute<Kind extends DestructiveOperationKind>(plan: ValidatedOperationPlan<Id, Kind>): Promise<void>;
  pullRebase(plan: ValidatedOperationPlan<Id, "pull-rebase">): Promise<void>;
  amendCommit(plan: ValidatedOperationPlan<Id, "amend-commit">): Promise<string>;
  discardPaths(plan: ValidatedOperationPlan<Id, "discard-paths">): Promise<void>;
  discardAll(plan: ValidatedOperationPlan<Id, "discard-all">): Promise<void>;
  resetHunk(plan: ValidatedOperationPlan<Id, "reset-hunk">): Promise<void>;
  resetHard(plan: ValidatedOperationPlan<Id, "reset-hard">): Promise<void>;
  clean(plan: ValidatedOperationPlan<Id, "clean">): Promise<void>;
  forceCheckout(plan: ValidatedOperationPlan<Id, "force-checkout">): Promise<void>;
  forceDeleteBranch(plan: ValidatedOperationPlan<Id, "force-delete-branch">): Promise<void>;
  abortOperation(plan: ValidatedOperationPlan<Id, "abort-operation">): Promise<void>;
  forceUpdateRemoteRef(plan: ValidatedOperationPlan<Id, "force-update-remote-ref">): Promise<void>;
}
