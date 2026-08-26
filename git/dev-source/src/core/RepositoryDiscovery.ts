import type { RepositoryId } from "../domain/RepositoryId";
import type { RepositoryLocator } from "../domain/RepositoryLocator";

export interface RepositoryIdentityStore {
  getOrCreate(locator: RepositoryLocator): Promise<RepositoryId>;
}

export interface RepositoryDiscoveryEntry {
  readonly repoId: RepositoryId;
  readonly displayPath: string;
  readonly candidateRoot: string;
  readonly result: "accepted" | "rejected" | "duplicate";
  readonly runtimeRoot: string | null;
  readonly errorCode: string | null;
  readonly message: string | null;
}

export interface RepositoryDiscoveryReport {
  readonly pluginsRoot: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly entries: readonly RepositoryDiscoveryEntry[];
}

export interface RepositoryDiscovery { discover(signal: AbortSignal): Promise<RepositoryDiscoveryReport>; }
