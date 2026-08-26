import type { CanonicalAbsolutePath } from "./RepoRelativePath";
import type { RepositoryFamilyId, RepositoryId } from "./RepositoryId";
import type { RepositoryLocator } from "./RepositoryLocator";

export interface RepositoryProbeTarget<Id extends RepositoryId = RepositoryId> {
  readonly repoId: Id;
  readonly locator: RepositoryLocator;
  readonly candidateRoot: CanonicalAbsolutePath;
  readonly displayPath: string;
}

export interface RepositoryProbeResult<Id extends RepositoryId = RepositoryId> {
  readonly repoId: Id;
  readonly target: RepositoryProbeTarget<Id>;
  readonly runtimeRoot: CanonicalAbsolutePath;
  readonly gitDir: CanonicalAbsolutePath;
  readonly commonDir: CanonicalAbsolutePath;
  readonly familyId: RepositoryFamilyId;
  readonly objectFormat: "sha1" | "sha256";
  readonly isInsideWorkTree: true;
  readonly superprojectRoot: CanonicalAbsolutePath | null;
}
