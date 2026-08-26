import type { RepoRelativePath, VaultRelativePath } from "./RepoRelativePath";
import type { RepositoryId } from "./RepositoryId";

export interface VaultRelativeRepositoryLocator {
  readonly kind: "vault-relative";
  readonly relativePath: VaultRelativePath;
}

export interface ExternalRepositoryLocator {
  readonly kind: "external";
  readonly locatorId: string;
  readonly lastKnownAbsolutePath: string;
}

export interface SubmoduleRepositoryLocator {
  readonly kind: "submodule";
  readonly superprojectId: RepositoryId;
  readonly relativePath: RepoRelativePath;
}

export type RepositoryLocator =
  | VaultRelativeRepositoryLocator
  | ExternalRepositoryLocator
  | SubmoduleRepositoryLocator;

