import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryProbeTarget } from "../domain/RepositoryProbe";
import type { RepositoryProbeBackend } from "../git/RepositoryProbeBackend";

export interface ProvisionalRepositoryContext<Id extends RepositoryId = RepositoryId> {
  readonly id: Id;
  readonly lifecycle: "probing";
  readonly target: RepositoryProbeTarget<Id>;
  readonly probeBackend: RepositoryProbeBackend<Id>;
}
