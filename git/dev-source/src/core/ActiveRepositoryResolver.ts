import type { CanonicalAbsolutePath } from "../domain/RepoRelativePath";
import type { RepositoryId } from "../domain/RepositoryId";
import { pathContains } from "../domain/PathSemantics";

export interface RepositoryResolutionEntry {
  readonly repoId: RepositoryId;
  readonly lifecycle: "ready" | "missing";
  readonly roots: readonly CanonicalAbsolutePath[];
}

export type ActiveRepositoryResolution =
  | { readonly kind: "resolved"; readonly repoId: RepositoryId }
  | { readonly kind: "missing"; readonly repoId: RepositoryId }
  | { readonly kind: "ambiguous"; readonly repoIds: readonly RepositoryId[] }
  | { readonly kind: "outside" };

export class ActiveRepositoryResolver {
  constructor(private readonly entries: () => readonly RepositoryResolutionEntry[]) {}

  resolve(path: CanonicalAbsolutePath): ActiveRepositoryResolution {
    const matches = this.entries().flatMap((entry) => {
      const longest = entry.roots.filter((root) => pathContains(root, path)).sort((left, right) => right.length - left.length)[0];
      return longest === undefined ? [] : [{ entry, root: longest }];
    }).sort((left, right) => right.root.length - left.root.length);
    const best = matches[0];
    if (best === undefined) return { kind: "outside" };
    const tied = matches.filter((match) => match.root.length === best.root.length);
    if (tied.length > 1) return { kind: "ambiguous", repoIds: Object.freeze(tied.map((match) => match.entry.repoId)) };
    return best.entry.lifecycle === "missing" ? { kind: "missing", repoId: best.entry.repoId } : { kind: "resolved", repoId: best.entry.repoId };
  }
}
