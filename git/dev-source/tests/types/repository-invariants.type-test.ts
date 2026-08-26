import type { UiApplication } from "../../src/application/public/UiApplication";
import type { AuthorizedGitOperation, AuthorizedGitOperationVerifier } from "../../src/authorization/OperationAuthorization";
import type { ProvisionalRepositoryContext } from "../../src/core/ProvisionalRepositoryContext";
import type { RepositoryContext } from "../../src/core/RepositoryContext";
import type { FileStatusEntry } from "../../src/domain/FileStatusEntry";
import { OPERATION_EFFECTS, type OperationImpactPlan, type OperationIntent } from "../../src/domain/OperationTypes";
import type { CommitRequest, PushRequest } from "../../src/domain/OperationRequests";
import type { CanonicalAbsolutePath, RepoRelativePath } from "../../src/domain/RepoRelativePath";
import type { RepositoryDescriptor, RepositoryMetadata } from "../../src/domain/RepositoryDescriptor";
import type { OperationId, RepositoryFamilyId, RepositoryId } from "../../src/domain/RepositoryId";
import type { RepositoryProbeTarget } from "../../src/domain/RepositoryProbe";
import type { SharedCommonDirRepositoryRelation } from "../../src/domain/RepositoryRelation";
import type { ValidatedOperationPlan, ValidatedOperationScope } from "../../src/domain/ValidatedOperationPlan";
import type { GitBackend } from "../../src/git/GitBackend";
import type { RepositoryProbeBackend } from "../../src/git/RepositoryProbeBackend";
import type { OperationQueue } from "../../src/operations/OperationQueue";
import type { RepositorySafetyFacade } from "../../src/safety/RepositorySafetyFacade";
import type { VerifiedDestructivePermit } from "../../src/safety/internal/VerifiedDestructiveExecutor";
import type { RepoStore } from "../../src/state/RepoStore";

type RepoA = RepositoryId<"repo-a">;
type RepoB = RepositoryId<"repo-b">;
declare const repoA: RepoA;
declare const repoB: RepoB;
declare const operationId: OperationId;
declare const familyId: RepositoryFamilyId;
declare const canonicalRoot: CanonicalAbsolutePath;
declare const impactA: OperationImpactPlan<RepoA>;
declare const backendA: GitBackend<RepoA>;
declare const backendB: GitBackend<RepoB>;
declare const descriptorA: RepositoryDescriptor<RepoA>;
declare const storeA: RepoStore<RepoA>;
declare const queueA: OperationQueue<RepoA>;
declare const safetyA: RepositorySafetyFacade<RepoA>;
declare const metadataA: RepositoryMetadata;
declare const probeTargetA: RepositoryProbeTarget<RepoA>;
declare const probeBackendA: RepositoryProbeBackend<RepoA>;
declare const uiApplication: UiApplication;
declare const statusPlanA: ValidatedOperationPlan<RepoA, "status">;
declare const statusPlanB: ValidatedOperationPlan<RepoB, "status">;
declare const authorizedStatusA: AuthorizedGitOperation<RepoA, "status">;
declare const authorizedStatusB: AuthorizedGitOperation<RepoB, "status">;
declare const authorizedVerifier: AuthorizedGitOperationVerifier;

void backendA.status(authorizedStatusA);
// @ts-expect-error A validated plan alone has no boundary/trust/queue authorization.
void backendA.status(statusPlanA);
// @ts-expect-error A plan for Repo B cannot execute on Repo A backend.
void backendA.status(authorizedStatusB);
void statusPlanB;
void authorizedVerifier.verifyFor(authorizedStatusA, repoA, "status");
// @ts-expect-error General verification without an expected backend target and method kind is forbidden.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
void authorizedVerifier.verify(authorizedStatusA);

const contextA: RepositoryContext<RepoA> = { id: repoA, descriptor: descriptorA, backend: backendA, store: storeA, queue: queueA, safety: safetyA, metadata: metadataA };
void contextA;
const provisionalA: ProvisionalRepositoryContext<RepoA> = { id: repoA, lifecycle: "probing", target: probeTargetA, probeBackend: probeBackendA };
void provisionalA;

// @ts-expect-error UI application exposes neither RepositoryContext nor GitBackend.
void uiApplication.backend;

// @ts-expect-error Every caller intent must identify a repository.
const missingRepoId: OperationIntent<RepoA, "status"> = {
  operationId, kind: "status", payload: {}, origin: "user", signal: new AbortController().signal, deadlineAt: Date.now() + 1_000
};
void missingRepoId;

const callerCannotDeclareEffects: OperationIntent<RepoA, "status"> = {
  repoId: repoA, operationId, kind: "status", payload: {}, origin: "user", signal: new AbortController().signal, deadlineAt: Date.now() + 1_000,
  // @ts-expect-error Effects are trusted planner output, never caller input.
  effects: OPERATION_EFFECTS.status
};
void callerCannotDeclareEffects;

// @ts-expect-error A validated plan cannot be forged outside the planner because its brand is inaccessible.
const forgedPlan: ValidatedOperationPlan<RepoA, "status"> = {
  repoId: repoA, operationId, kind: "status", payload: {}, effects: OPERATION_EFFECTS.status,
  scope: { kind: "single-context", participants: [{ repoId: repoA, impact: impactA }] },
  origin: "user", signal: new AbortController().signal, deadlineAt: Date.now() + 1_000
};
void forgedPlan;

const invalidCrossScope: ValidatedOperationScope<RepoA> = {
  kind: "cross-context", relation: "nested",
  // @ts-expect-error Cross-context plans require at least two participant impacts.
  participants: []
};
void invalidCrossScope;

const mixedContext: RepositoryContext<RepoA> = {
  id: repoA, descriptor: descriptorA,
  // @ts-expect-error A backend for Repo B cannot be installed in Repo A context.
  backend: backendB,
  store: storeA, queue: queueA, safety: safetyA
};
void mixedContext;

const retargetedIntent: OperationIntent<RepoA, "status"> = {
  repoId: repoA, operationId, kind: "status", payload: {}, origin: "user", signal: new AbortController().signal, deadlineAt: Date.now() + 1_000,
  // @ts-expect-error Operation intents cannot retarget execution with cwd.
  cwd: "/tmp/other-repository"
};
void retargetedIntent;

const retargetedPayload: OperationIntent<RepoA, "status"> = {
  repoId: repoA, operationId, kind: "status",
  // @ts-expect-error Empty operation payloads reject hidden execution target fields.
  payload: { cwd: "/tmp/other-repository" },
  origin: "user", signal: new AbortController().signal, deadlineAt: Date.now() + 1_000
};
void retargetedPayload;

// @ts-expect-error Plain strings are not repository-relative paths.
const unsafePath: RepoRelativePath = "../other-repository/file.ts";
void unsafePath;
const unsafeDescriptor: RepositoryDescriptor<RepoA> = {
  ...descriptorA,
  // @ts-expect-error Runtime root must be a canonical absolute path brand.
  runtimeRoot: "/unverified/path"
};
void unsafeDescriptor;

// @ts-expect-error Probe target has no resolved gitDir.
void probeTargetA.gitDir;
// @ts-expect-error Final GitBackend has no probe method.
void backendA.probe;
// @ts-expect-error Restricted probe backend has no status method.
void probeBackendA.status;
// @ts-expect-error Provisional context cannot be used as resolved context.
const unresolvedContext: RepositoryContext<RepoA> = provisionalA;
void unresolvedContext;

const forcePush: PushRequest = {
  remote: "upstream" as PushRequest["remote"], source: "refs/heads/topic" as PushRequest["source"], target: "refs/heads/topic" as PushRequest["target"], setUpstream: false,
  // @ts-expect-error Ordinary push has no force option.
  force: true
};
void forcePush;
const amendCommit: CommitRequest = {
  message: "rewrite",
  // @ts-expect-error Ordinary commit has no amend option.
  amend: true
};
void amendCommit;
// @ts-expect-error Destructive pull-rebase is absent from public GitBackend.
void backendA.pullRebase;
// @ts-expect-error Destructive discard is absent from public GitBackend.
void backendA.discardAll;

// @ts-expect-error Opaque destructive permit cannot be constructed outside safety issuer.
const forgedPermit: VerifiedDestructivePermit<RepoA, "reset-hard"> = {
  repoId: repoA, operationId, kind: "reset-hard",
  planIdentity: statusPlanA.planIdentity,
  planDigest: statusPlanA.planDigest,
  payloadDigest: statusPlanA.payloadDigest,
  backupId: "forged" as VerifiedDestructivePermit<RepoA, "reset-hard">["backupId"]
};
void forgedPermit;

declare const path: RepoRelativePath;
const dualStatus: FileStatusEntry = { path, indexStatus: "modified", worktreeStatus: "modified", untracked: false, changeKind: "ordinary" };
void dualStatus;
const sharedFamily: SharedCommonDirRepositoryRelation<RepoA, RepoB> = { kind: "shared-common-dir", left: repoA, right: repoB, familyId, commonDir: canonicalRoot };
void sharedFamily;
