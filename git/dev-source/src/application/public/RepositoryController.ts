import type { OperationId, RepositoryId } from "../../domain/RepositoryId";
import type { RepositoryDiagnosticReadModel, RepositoryRefreshResult } from "./PublicReadModels";

export interface RepositoryCommandRequest<Id extends RepositoryId = RepositoryId> { readonly repoId: Id; }
export interface CancelRepositoryOperationRequest<Id extends RepositoryId = RepositoryId> extends RepositoryCommandRequest<Id> { readonly operationId: OperationId; }
export interface RepositoryController {
  refresh<Id extends RepositoryId>(request: RepositoryCommandRequest<Id>): Promise<void>;
  refreshAll(): Promise<readonly RepositoryRefreshResult[]>;
  list(): readonly RepositoryDiagnosticReadModel[];
  cancel<Id extends RepositoryId>(request: CancelRepositoryOperationRequest<Id>): boolean;
}
