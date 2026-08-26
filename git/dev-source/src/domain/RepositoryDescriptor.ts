import type { CanonicalAbsolutePath } from "./RepoRelativePath";
import type { RepositoryFamilyId, RepositoryId } from "./RepositoryId";
import type { RepositoryLocator } from "./RepositoryLocator";

export interface RepositoryDescriptor<Id extends RepositoryId = RepositoryId> {
  readonly repositoryId: Id;
  readonly familyId: RepositoryFamilyId;
  readonly name: string;
  readonly locator: RepositoryLocator;
  readonly runtimeRoot: CanonicalAbsolutePath;
  readonly displayPath: string;
  readonly gitDir: CanonicalAbsolutePath;
  readonly commonDir: CanonicalAbsolutePath;
  readonly superprojectRoot: CanonicalAbsolutePath | null;
  readonly objectFormat: "sha1" | "sha256";
  readonly aliases: readonly CanonicalAbsolutePath[];
}

export interface RepositoryMetadata {
  readonly discoveredAt: number;
  readonly source: "vault-plugin" | "external" | "submodule";
  readonly trust: "trusted" | "untrusted";
}

export type RepositoryLifecycle =
  | "ready"
  | "missing"
  | "disposing"
  | "disposed";
