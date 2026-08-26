import type { DestructiveOperationKind } from "../domain/OperationTypes";
import type { RepositoryId } from "../domain/RepositoryId";
import type { ValidatedOperationPlan } from "../domain/ValidatedOperationPlan";
import type { RepositorySafetyFacade } from "./RepositorySafetyFacade";

const unavailable = (): Promise<never> => Promise.reject(new TypeError("Mutating and destructive Git operations are unavailable in stage 2"));

export class StageTwoUnavailableSafetyFacade<Id extends RepositoryId = RepositoryId> implements RepositorySafetyFacade<Id> {
  constructor(readonly repositoryId: Id) {}
  execute<Kind extends DestructiveOperationKind>(plan: ValidatedOperationPlan<Id, Kind>): Promise<void> { void plan; return unavailable(); }
  pullRebase(plan: ValidatedOperationPlan<Id, "pull-rebase">): Promise<void> { void plan; return unavailable(); }
  amendCommit(plan: ValidatedOperationPlan<Id, "amend-commit">): Promise<string> { void plan; return unavailable(); }
  discardPaths(plan: ValidatedOperationPlan<Id, "discard-paths">): Promise<void> { void plan; return unavailable(); }
  discardAll(plan: ValidatedOperationPlan<Id, "discard-all">): Promise<void> { void plan; return unavailable(); }
  resetHunk(plan: ValidatedOperationPlan<Id, "reset-hunk">): Promise<void> { void plan; return unavailable(); }
  resetHard(plan: ValidatedOperationPlan<Id, "reset-hard">): Promise<void> { void plan; return unavailable(); }
  clean(plan: ValidatedOperationPlan<Id, "clean">): Promise<void> { void plan; return unavailable(); }
  forceCheckout(plan: ValidatedOperationPlan<Id, "force-checkout">): Promise<void> { void plan; return unavailable(); }
  forceDeleteBranch(plan: ValidatedOperationPlan<Id, "force-delete-branch">): Promise<void> { void plan; return unavailable(); }
  abortOperation(plan: ValidatedOperationPlan<Id, "abort-operation">): Promise<void> { void plan; return unavailable(); }
  forceUpdateRemoteRef(plan: ValidatedOperationPlan<Id, "force-update-remote-ref">): Promise<void> { void plan; return unavailable(); }
}
