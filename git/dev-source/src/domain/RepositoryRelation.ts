import type { CanonicalAbsolutePath, RepoRelativePath } from "./RepoRelativePath";
import type { RepositoryFamilyId, RepositoryId } from "./RepositoryId";

export interface DisjointRepositoryRelation<
  Left extends RepositoryId = RepositoryId,
  Right extends RepositoryId = RepositoryId
> {
  readonly kind: "disjoint";
  readonly left: Left;
  readonly right: Right;
}

export interface NestedRepositoryRelation<
  Parent extends RepositoryId = RepositoryId,
  Child extends RepositoryId = RepositoryId
> {
  readonly kind: "nested";
  readonly parent: Parent;
  readonly child: Child;
}

export interface SubmoduleOfRepositoryRelation<
  Child extends RepositoryId = RepositoryId,
  Superproject extends RepositoryId = RepositoryId
> {
  readonly kind: "submodule-of";
  readonly child: Child;
  readonly superproject: Superproject;
  readonly path: RepoRelativePath;
}

export interface SuperprojectOfRepositoryRelation<
  Superproject extends RepositoryId = RepositoryId,
  Submodule extends RepositoryId = RepositoryId
> {
  readonly kind: "superproject-of";
  readonly superproject: Superproject;
  readonly submodule: Submodule;
  readonly path: RepoRelativePath;
}

export interface SharedCommonDirRepositoryRelation<
  Left extends RepositoryId = RepositoryId,
  Right extends RepositoryId = RepositoryId
> {
  readonly kind: "shared-common-dir";
  readonly left: Left;
  readonly right: Right;
  readonly familyId: RepositoryFamilyId;
  readonly commonDir: CanonicalAbsolutePath;
}

export type RepositoryRelation =
  | DisjointRepositoryRelation
  | NestedRepositoryRelation
  | SubmoduleOfRepositoryRelation
  | SuperprojectOfRepositoryRelation
  | SharedCommonDirRepositoryRelation;

export type RepositoryRelationKind = RepositoryRelation["kind"];

export interface RepositoryFamily {
  readonly id: RepositoryFamilyId;
  readonly commonDir: CanonicalAbsolutePath;
  readonly members: readonly [RepositoryId, ...RepositoryId[]];
}

export type NestedPathOwnership = "opaque-child" | "parent-tracked-overlap" | "unknown";
