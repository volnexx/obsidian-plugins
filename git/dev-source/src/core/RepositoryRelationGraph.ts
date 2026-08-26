import type { RepositoryId } from "../domain/RepositoryId";
import type { NestedPathOwnership, RepositoryFamily, RepositoryRelation } from "../domain/RepositoryRelation";
import type { RepoRelativePath } from "../domain/RepoRelativePath";
import { pathContains } from "../domain/PathSemantics";
import type { RepositoryDescriptor } from "../domain/RepositoryDescriptor";

export interface RepositoryRelationGraph {
  relation(left: RepositoryId, right: RepositoryId): RepositoryRelation;
  related(repoId: RepositoryId): readonly RepositoryRelation[];
  family(repoId: RepositoryId): RepositoryFamily | null;
  areByteIsolated(left: RepositoryId, right: RepositoryId): boolean;
  nestedPathOwnership(
    parent: RepositoryId,
    child: RepositoryId,
    path: RepoRelativePath
  ): NestedPathOwnership;
}

export class RuntimeRepositoryRelationGraph implements RepositoryRelationGraph {
  #descriptors = new Map<RepositoryId, RepositoryDescriptor>();

  replace(descriptors: readonly RepositoryDescriptor[]): void { this.#descriptors = new Map(descriptors.map((descriptor) => [descriptor.repositoryId, descriptor])); }

  relation(left: RepositoryId, right: RepositoryId): RepositoryRelation {
    const leftDescriptor = this.#required(left);
    const rightDescriptor = this.#required(right);
    if (leftDescriptor.commonDir === rightDescriptor.commonDir && left !== right) return { kind: "shared-common-dir", left, right, familyId: leftDescriptor.familyId, commonDir: leftDescriptor.commonDir };
    if (leftDescriptor.superprojectRoot === rightDescriptor.runtimeRoot) return { kind: "submodule-of", child: left, superproject: right, path: leftDescriptor.runtimeRoot.slice(rightDescriptor.runtimeRoot.length + 1) as RepoRelativePath };
    if (rightDescriptor.superprojectRoot === leftDescriptor.runtimeRoot) return { kind: "superproject-of", superproject: left, submodule: right, path: rightDescriptor.runtimeRoot.slice(leftDescriptor.runtimeRoot.length + 1) as RepoRelativePath };
    if (pathContains(leftDescriptor.runtimeRoot, rightDescriptor.runtimeRoot)) return { kind: "nested", parent: left, child: right };
    if (pathContains(rightDescriptor.runtimeRoot, leftDescriptor.runtimeRoot)) return { kind: "nested", parent: right, child: left };
    return { kind: "disjoint", left, right };
  }

  related(repoId: RepositoryId): readonly RepositoryRelation[] { return [...this.#descriptors.keys()].filter((other) => other !== repoId).map((other) => this.relation(repoId, other)); }

  family(repoId: RepositoryId): RepositoryFamily | null {
    const descriptor = this.#descriptors.get(repoId);
    if (descriptor === undefined) return null;
    const members = [...this.#descriptors.values()].filter((candidate) => candidate.commonDir === descriptor.commonDir).map((candidate) => candidate.repositoryId).sort((left, right) => left.localeCompare(right));
    if (members.length === 0) return null;
    return { id: descriptor.familyId, commonDir: descriptor.commonDir, members: members as [RepositoryId, ...RepositoryId[]] };
  }

  areByteIsolated(left: RepositoryId, right: RepositoryId): boolean { return this.relation(left, right).kind === "disjoint"; }
  nestedPathOwnership(): NestedPathOwnership { return "unknown"; }
  #required(repoId: RepositoryId): RepositoryDescriptor { const value = this.#descriptors.get(repoId); if (value === undefined) throw new TypeError(`Unknown repository ${repoId}`); return value; }
}
