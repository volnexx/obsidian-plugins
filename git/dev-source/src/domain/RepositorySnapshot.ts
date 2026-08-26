import type { FileStatusEntry } from "./FileStatusEntry";
import type { RepositoryId } from "./RepositoryId";

export interface BranchState {
  readonly head: string | null;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
}

export interface RepositoryObservation<Id extends RepositoryId = RepositoryId> {
  readonly repositoryId: Id;
  readonly branch: BranchState;
  readonly files: readonly FileStatusEntry[];
  readonly observedAt: number;
}
