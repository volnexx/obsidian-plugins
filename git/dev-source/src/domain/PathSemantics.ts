import type { CanonicalAbsolutePath } from "./RepoRelativePath";

export const pathContains = (root: CanonicalAbsolutePath, candidate: CanonicalAbsolutePath): boolean =>
  candidate === root || candidate.startsWith(`${root}/`);
