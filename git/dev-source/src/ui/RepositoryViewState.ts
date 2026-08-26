import type { RepositoryId } from "../application/public/PublicReadModels";

export interface RepositoryViewState<Id extends RepositoryId = RepositoryId> {
  readonly repoId: Id;
  readonly view: "dashboard" | "source-control" | "diff" | "history" | "graph" | "conflicts";
}
