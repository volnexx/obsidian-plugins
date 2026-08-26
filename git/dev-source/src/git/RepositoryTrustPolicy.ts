import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryTrust } from "../domain/RepositoryTrust";

export type { RepositoryTrust } from "../domain/RepositoryTrust";

export interface RepositoryTrustRecord<Id extends RepositoryId = RepositoryId> {
  readonly repoId: Id;
  readonly trust: RepositoryTrust;
  readonly decidedAt: number;
  readonly decidedBy: "default-discovery" | "user" | "policy-revocation";
}

export interface RepositoryTrustPolicy {
  read<Id extends RepositoryId>(repoId: Id): Promise<RepositoryTrustRecord<Id>>;
  trust<Id extends RepositoryId>(repoId: Id): Promise<RepositoryTrustRecord<Id>>;
  revoke<Id extends RepositoryId>(repoId: Id): Promise<RepositoryTrustRecord<Id>>;
}
