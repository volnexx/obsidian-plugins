declare const repoRelativePathBrand: unique symbol;
declare const vaultRelativePathBrand: unique symbol;
declare const canonicalAbsolutePathBrand: unique symbol;

export type RepoRelativePath = string & {
  readonly [repoRelativePathBrand]: true;
};

export type VaultRelativePath = string & {
  readonly [vaultRelativePathBrand]: true;
};

export type CanonicalAbsolutePath = string & {
  readonly [canonicalAbsolutePathBrand]: true;
};

