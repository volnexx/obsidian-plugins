import { createHash, randomUUID } from "node:crypto";

import type { DestructiveOperationKind, OperationImpactPlan } from "../domain/OperationTypes";
import type { CanonicalAbsolutePath, RepoRelativePath } from "../domain/RepoRelativePath";
import type { RepositoryDescriptor } from "../domain/RepositoryDescriptor";
import type { RepositoryFamilyId, RepositoryId } from "../domain/RepositoryId";
import type { CanonicalPayloadDigest, CanonicalPlanDigest, OperationPlanIdentity, ValidatedOperationPlan, ValidatedOperationPlanVerifier } from "../domain/ValidatedOperationPlan";
import { pathContains } from "../domain/PathSemantics";

declare const backupPlanDigestBrand: unique symbol;
export type BackupPlanDigest = string & { readonly [backupPlanDigestBrand]: true };

export interface BackupRequirement {
  readonly worktree: "none" | "explicit-paths" | "entire-worktree";
  readonly worktreePaths: readonly RepoRelativePath[];
  readonly index: "none" | "full-index";
  readonly refs: "none" | "explicit-refs" | "all-local-refs";
  readonly refNames: readonly string[];
  readonly gitObjects: boolean;
  readonly gitConfig: boolean;
}

export interface BackupPreflightIdentity { readonly digest: string; }
export interface BackupStateInspector {
  inspect(descriptor: RepositoryDescriptor, requirement: BackupRequirement, signal: AbortSignal, deadlineAt: number): Promise<BackupPreflightIdentity>;
}
export interface RepositoryDescriptorCatalog {
  get(repoId: RepositoryId): RepositoryDescriptor | undefined;
  list(): readonly RepositoryDescriptor[];
}

export interface BackupPlanParticipant {
  readonly repoId: RepositoryId;
  readonly familyId: RepositoryFamilyId;
  readonly runtimeRoot: CanonicalAbsolutePath;
  readonly gitDir: CanonicalAbsolutePath;
  readonly commonDir: CanonicalAbsolutePath;
  readonly objectFormat: "sha1" | "sha256";
  readonly impact: OperationImpactPlan;
  readonly requirements: BackupRequirement;
  readonly preflightIdentity: string;
}

const stableValue = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stableValue)
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stableValue(nested)]))
    : value;
const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
const immutableSnapshot = <Value>(value: Value): Value => {
  const snapshot = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const key of Reflect.ownKeys(candidate)) freeze(Reflect.get(candidate, key));
    Object.freeze(candidate);
  };
  freeze(snapshot);
  return snapshot;
};

const deriveRequirement = (impact: OperationImpactPlan, plan: ValidatedOperationPlan<RepositoryId, DestructiveOperationKind>): BackupRequirement => {
  let worktree: BackupRequirement["worktree"] = "none";
  if (plan.effects.mutatesWorktree) {
    if (impact.worktree.scope === "explicit-paths") worktree = "explicit-paths";
    else if (impact.worktree.scope === "entire-worktree") worktree = "entire-worktree";
    else throw new TypeError("Destructive worktree plan has incomplete impact");
  }
  let refs: BackupRequirement["refs"] = "none";
  if (plan.effects.mutatesLocalRefs) {
    if (impact.localRefs.scope === "explicit-refs") refs = "explicit-refs";
    else if (impact.localRefs.scope === "all-refs") refs = "all-local-refs";
    else throw new TypeError("Destructive ref plan has incomplete impact");
  }
  if (impact.worktree.scope === "unknown" || impact.index.scope === "unknown" || impact.gitMetadata.scope === "unknown" || impact.localRefs.scope === "unknown") throw new TypeError("Backup impact is unknown");
  return {
    worktree,
    worktreePaths: worktree === "explicit-paths" ? [...impact.worktree.paths].sort((left, right) => left.localeCompare(right)) : [],
    index: plan.effects.mutatesIndex ? "full-index" : "none",
    refs,
    refNames: refs === "explicit-refs" ? [...impact.localRefs.refs].sort((left, right) => left.localeCompare(right)) : [],
    gitObjects: plan.effects.mutatesLocalRefs,
    gitConfig: plan.effects.mutatesGitConfig
  };
};

const planIssuers = new WeakMap<object, symbol>();
const constructionToken = Symbol("backup-plan-construction");

export class BackupPlan<Id extends RepositoryId = RepositoryId, Kind extends DestructiveOperationKind = DestructiveOperationKind> {
  declare private readonly runtimeCapability: typeof constructionToken;
  constructor(
    token: typeof constructionToken,
    readonly sourcePlan: ValidatedOperationPlan<Id, Kind>,
    readonly backupPlanId: string,
    readonly backupPlanDigest: BackupPlanDigest,
    readonly repoId: Id,
    readonly kind: Kind,
    readonly planIdentity: OperationPlanIdentity,
    readonly planDigest: CanonicalPlanDigest,
    readonly payloadDigest: CanonicalPayloadDigest,
    readonly repositoryIds: readonly RepositoryId[],
    readonly familyIds: readonly RepositoryFamilyId[],
    readonly participants: readonly BackupPlanParticipant[],
    readonly signal: AbortSignal,
    readonly deadlineAt: number
  ) {
    if (token !== constructionToken) throw new TypeError("BackupPlan must be issued by its runtime authority");
    Object.freeze(this);
  }
}

export interface BackupPlanVerifier {
  verify<Id extends RepositoryId, Kind extends DestructiveOperationKind>(candidate: unknown, plan: ValidatedOperationPlan<Id, Kind>): candidate is BackupPlan<Id, Kind>;
}

export class RuntimeBackupPlanAuthority implements BackupPlanVerifier {
  readonly #issuerId = Symbol("backup-plan-issuer");
  constructor(private readonly planVerifier: ValidatedOperationPlanVerifier, private readonly catalog: RepositoryDescriptorCatalog, private readonly inspector: BackupStateInspector) {}

  async derive<Id extends RepositoryId, Kind extends DestructiveOperationKind>(plan: ValidatedOperationPlan<Id, Kind>): Promise<BackupPlan<Id, Kind>> {
    if (!this.planVerifier.verify(plan)) throw new TypeError("Backup requires a genuine validated destructive operation plan");
    const repositoryIds = [...plan.requiredLocks.repositoryIds];
    const familyIds = [...plan.requiredLocks.familyIds];
    const participantSet = new Set(repositoryIds);
    const participants: BackupPlanParticipant[] = [];
    for (const participant of plan.scope.participants) {
      const descriptor = this.catalog.get(participant.repoId);
      if (descriptor === undefined) throw new TypeError(`Backup participant ${participant.repoId} is unresolved`);
      const requirements = deriveRequirement(participant.impact, plan);
      if (requirements.worktree === "entire-worktree") {
        const unmodeledNested = this.catalog.list().find((candidate) => candidate.repositoryId !== descriptor.repositoryId && pathContains(descriptor.runtimeRoot, candidate.runtimeRoot) && !participantSet.has(candidate.repositoryId));
        if (unmodeledNested !== undefined) throw new TypeError(`Entire-worktree backup crosses unmodeled repository ${unmodeledNested.repositoryId}`);
      }
      const preflight = await this.inspector.inspect(descriptor, requirements, plan.signal, plan.deadlineAt);
      participants.push({ repoId: descriptor.repositoryId, familyId: descriptor.familyId, runtimeRoot: descriptor.runtimeRoot, gitDir: descriptor.gitDir, commonDir: descriptor.commonDir, objectFormat: descriptor.objectFormat, impact: participant.impact, requirements, preflightIdentity: preflight.digest });
    }
    const snapshot = immutableSnapshot({ repositoryIds, familyIds, participants });
    const backupPlanId = randomUUID();
    const binding = { backupPlanId, repoId: plan.repoId, kind: plan.kind, planIdentity: plan.planIdentity, planDigest: plan.planDigest, payloadDigest: plan.payloadDigest, ...snapshot };
    const result = new BackupPlan(constructionToken, plan, backupPlanId, sha256(binding) as BackupPlanDigest, plan.repoId, plan.kind, plan.planIdentity, plan.planDigest, plan.payloadDigest, snapshot.repositoryIds, snapshot.familyIds, snapshot.participants, plan.signal, plan.deadlineAt);
    planIssuers.set(result, this.#issuerId);
    return result;
  }

  verify<Id extends RepositoryId, Kind extends DestructiveOperationKind>(candidate: unknown, plan: ValidatedOperationPlan<Id, Kind>): candidate is BackupPlan<Id, Kind> {
    if (!(candidate instanceof BackupPlan) || planIssuers.get(candidate) !== this.#issuerId || !this.planVerifier.verify(plan)) return false;
    const verifiedCandidate = candidate as unknown as BackupPlan;
    const binding = { backupPlanId: verifiedCandidate.backupPlanId, repoId: verifiedCandidate.repoId, kind: verifiedCandidate.kind, planIdentity: verifiedCandidate.planIdentity, planDigest: verifiedCandidate.planDigest, payloadDigest: verifiedCandidate.payloadDigest, repositoryIds: verifiedCandidate.repositoryIds, familyIds: verifiedCandidate.familyIds, participants: verifiedCandidate.participants };
    return verifiedCandidate.sourcePlan === plan && verifiedCandidate.repoId === plan.repoId && verifiedCandidate.kind === plan.kind && verifiedCandidate.planIdentity === plan.planIdentity && verifiedCandidate.planDigest === plan.planDigest && verifiedCandidate.payloadDigest === plan.payloadDigest && verifiedCandidate.backupPlanDigest === sha256(binding);
  }
}
