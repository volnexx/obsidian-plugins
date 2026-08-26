import type { OperationKind, OperationPayload, RemoteName } from "./OperationRequests";
import type { CanonicalAbsolutePath, RepoRelativePath } from "./RepoRelativePath";
import type { OperationId, RepositoryFamilyId, RepositoryId } from "./RepositoryId";

export type { OperationKind } from "./OperationRequests";

export interface OperationEffects {
  readonly network: boolean;
  readonly mutatesWorktree: boolean;
  readonly mutatesIndex: boolean;
  readonly mutatesGitConfig: boolean;
  readonly mutatesGitMetadata: boolean;
  readonly mutatesLocalRefs: boolean;
  readonly mutatesRemoteRefs: boolean;
  readonly destructive: boolean;
}

const noEffects = {
  network: false,
  mutatesWorktree: false,
  mutatesIndex: false,
  mutatesGitConfig: false,
  mutatesGitMetadata: false,
  mutatesLocalRefs: false,
  mutatesRemoteRefs: false,
  destructive: false
} as const satisfies OperationEffects;

type CompleteEffects<Overrides extends Partial<OperationEffects>> = {
  readonly [Key in keyof OperationEffects]: Key extends keyof Overrides ? Overrides[Key] : false;
};

const effects = <Overrides extends Partial<OperationEffects>>(overrides: Overrides): CompleteEffects<Overrides> =>
  ({ ...noEffects, ...overrides }) as CompleteEffects<Overrides>;

export const OPERATION_EFFECTS = {
  probe: effects({}),
  status: effects({}),
  log: effects({}),
  diff: effects({}),
  "list-branches": effects({}),
  "list-remotes": effects({}),
  "read-upstream": effects({}),
  stage: effects({ mutatesIndex: true }),
  unstage: effects({ mutatesIndex: true }),
  commit: effects({ mutatesGitMetadata: true, mutatesLocalRefs: true }),
  checkout: effects({ mutatesWorktree: true, mutatesIndex: true, mutatesGitMetadata: true }),
  "create-branch": effects({ mutatesGitMetadata: true, mutatesLocalRefs: true }),
  "delete-branch": effects({ mutatesGitMetadata: true, mutatesLocalRefs: true }),
  "add-remote": effects({ mutatesGitConfig: true, mutatesGitMetadata: true }),
  "set-remote-url": effects({ mutatesGitConfig: true, mutatesGitMetadata: true }),
  "remove-remote": effects({ mutatesGitConfig: true, mutatesGitMetadata: true }),
  "set-upstream": effects({ mutatesGitConfig: true, mutatesGitMetadata: true }),
  "continue-operation": effects({ mutatesWorktree: true, mutatesIndex: true, mutatesGitMetadata: true, mutatesLocalRefs: true }),
  fetch: effects({ network: true, mutatesGitMetadata: true, mutatesLocalRefs: true }),
  "pull-ff-only": effects({ network: true, mutatesWorktree: true, mutatesIndex: true, mutatesGitMetadata: true, mutatesLocalRefs: true }),
  "pull-merge": effects({ network: true, mutatesWorktree: true, mutatesIndex: true, mutatesGitMetadata: true, mutatesLocalRefs: true }),
  push: effects({ network: true, mutatesRemoteRefs: true }),
  "pull-rebase": effects({ network: true, mutatesWorktree: true, mutatesIndex: true, mutatesGitMetadata: true, mutatesLocalRefs: true, destructive: true }),
  "amend-commit": effects({ mutatesGitMetadata: true, mutatesLocalRefs: true, destructive: true }),
  "discard-paths": effects({ mutatesWorktree: true, destructive: true }),
  "discard-all": effects({ mutatesWorktree: true, destructive: true }),
  "reset-hunk": effects({ mutatesWorktree: true, destructive: true }),
  "reset-hard": effects({ mutatesWorktree: true, mutatesIndex: true, mutatesGitMetadata: true, mutatesLocalRefs: true, destructive: true }),
  clean: effects({ mutatesWorktree: true, destructive: true }),
  "force-checkout": effects({ mutatesWorktree: true, mutatesIndex: true, mutatesGitMetadata: true, destructive: true }),
  "force-delete-branch": effects({ mutatesGitMetadata: true, mutatesLocalRefs: true, destructive: true }),
  "abort-operation": effects({ mutatesWorktree: true, mutatesIndex: true, mutatesGitMetadata: true, mutatesLocalRefs: true, destructive: true }),
  "force-update-remote-ref": effects({ network: true, mutatesRemoteRefs: true, destructive: true })
} as const satisfies Readonly<Record<OperationKind, OperationEffects>>;

export type OperationEffectsFor<Kind extends OperationKind> = (typeof OPERATION_EFFECTS)[Kind];
export type DestructiveOperationKind = {
  [Kind in OperationKind]: OperationEffectsFor<Kind>["destructive"] extends true ? Kind : never;
}[OperationKind];
export type OperationOrigin = "user" | "automation" | "bulk" | "watcher" | "system";

export interface OperationIntent<Id extends RepositoryId = RepositoryId, Kind extends OperationKind = OperationKind> {
  readonly repoId: Id;
  readonly operationId: OperationId;
  readonly kind: Kind;
  readonly payload: OperationPayload<Kind>;
  readonly origin: OperationOrigin;
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
}

export interface WorktreeImpactPlan { readonly scope: "none" | "explicit-paths" | "entire-worktree" | "unknown"; readonly paths: readonly RepoRelativePath[]; }
export interface IndexImpactPlan { readonly scope: "none" | "explicit-paths" | "entire-index" | "unknown"; readonly paths: readonly RepoRelativePath[]; }
export interface GitConfigImpactPlan { readonly scope: "none" | "explicit-keys" | "entire-config" | "unknown"; readonly keys: readonly string[]; }
export interface GitMetadataImpactPlan { readonly scope: "none" | "repository-local" | "shared-common-dir" | "unknown"; readonly namespaces: readonly string[]; }
export interface RefImpactPlan { readonly scope: "none" | "explicit-refs" | "all-refs" | "unknown"; readonly refs: readonly string[]; }

export type RemoteTargetIdentity =
  | { readonly kind: "registered-context"; readonly remote: RemoteName; readonly targetRepoId: RepositoryId; readonly targetFamilyId: RepositoryFamilyId; readonly canonicalTargetRoot: CanonicalAbsolutePath }
  | { readonly kind: "external"; readonly remote: RemoteName; readonly canonicalUrlDigest: string };
export interface RemoteRefTargetImpact { readonly target: RemoteTargetIdentity; readonly refs: readonly string[]; }
export interface RemoteRefImpactPlan { readonly scope: "none" | "explicit-targets" | "unknown"; readonly targets: readonly RemoteRefTargetImpact[]; }

export interface OperationImpactPlan<Id extends RepositoryId = RepositoryId> {
  readonly repoId: Id;
  readonly worktree: WorktreeImpactPlan;
  readonly index: IndexImpactPlan;
  readonly gitConfig: GitConfigImpactPlan;
  readonly gitMetadata: GitMetadataImpactPlan;
  readonly localRefs: RefImpactPlan;
  readonly remoteRefs: RemoteRefImpactPlan;
}

export const hasMutationEffects = (value: OperationEffects): boolean =>
  value.mutatesWorktree || value.mutatesIndex || value.mutatesGitConfig || value.mutatesGitMetadata || value.mutatesLocalRefs || value.mutatesRemoteRefs;
export const isDestructiveOperationKind = (kind: OperationKind): boolean => OPERATION_EFFECTS[kind].destructive;

/** Runtime guard required at the trusted planner boundary; mismatches fail closed. */
export function assertTrustedEffects<Kind extends OperationKind>(kind: Kind, actual: OperationEffects): asserts actual is OperationEffectsFor<Kind> {
  const expected: OperationEffects = OPERATION_EFFECTS[kind];
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`Operation effects shape mismatch for ${kind}`);
  }
  for (const key of expectedKeys as (keyof OperationEffects)[]) {
    if (actual[key] !== expected[key]) throw new Error(`Operation effects mismatch for ${kind}:${key}`);
  }
}
