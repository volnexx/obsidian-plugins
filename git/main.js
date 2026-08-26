"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GitPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/composition/PluginRuntime.ts
var import_obsidian2 = require("obsidian");

// src/application/internal/RuntimeRepositoryController.ts
var import_node_crypto = require("node:crypto");
var RuntimeRepositoryController = class {
  constructor(registry, planner, execution, clock = Date.now) {
    this.registry = registry;
    this.planner = planner;
    this.execution = execution;
    this.clock = clock;
  }
  registry;
  planner;
  execution;
  clock;
  #controllers = /* @__PURE__ */ new Map();
  async refresh(request) {
    const context = this.registry.getRequired(request.repoId);
    const operationId = (0, import_node_crypto.randomUUID)();
    const abortController = new AbortController();
    this.#controllers.set(operationId, abortController);
    const intent = { repoId: request.repoId, operationId, kind: "status", payload: {}, origin: "user", signal: abortController.signal, deadlineAt: this.clock() + 3e4 };
    const plan = await this.planner.plan(intent);
    context.store.beginOperation({ plan, startedAt: this.clock(), progress: null });
    try {
      const observation = await this.execution.execute(plan, (authorized) => context.backend.status(authorized));
      context.store.applyObservation(observation);
      context.store.finishOperation();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "repository-missing") this.registry.markMissing(context.id);
      context.store.fail({ code: error instanceof Error && "code" in error ? String(error.code) : "status-failed", message: error instanceof Error ? error.message : String(error), operationId });
      throw error;
    } finally {
      this.#controllers.delete(operationId);
    }
  }
  async refreshAll() {
    const contexts = this.registry.list();
    const results = await Promise.all(contexts.map(async (context) => {
      try {
        await this.refresh({ repoId: context.id });
        return { repositoryId: context.id, ok: true, error: null };
      } catch (error) {
        return { repositoryId: context.id, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    return Object.freeze(results);
  }
  list() {
    return Object.freeze(this.registry.list().map((context) => {
      const snapshot = context.store.snapshot?.observation;
      const files = snapshot?.files ?? [];
      return Object.freeze({
        repositoryId: context.id,
        displayPath: context.descriptor.displayPath,
        rootPath: context.descriptor.runtimeRoot,
        branch: snapshot?.branch.head ?? (snapshot?.branch.detached === true ? "(detached)" : "(unknown)"),
        detached: snapshot?.branch.detached ?? false,
        upstream: snapshot?.branch.upstream ?? null,
        ahead: snapshot?.branch.ahead ?? 0,
        behind: snapshot?.branch.behind ?? 0,
        staged: files.filter((file) => file.indexStatus !== "unmodified").length,
        unstaged: files.filter((file) => file.worktreeStatus !== "unmodified").length,
        untracked: files.filter((file) => file.untracked).length,
        conflicts: files.filter((file) => file.changeKind === "unmerged").length,
        lifecycle: context.store.lifecycle,
        error: context.store.lastError?.message ?? null
      });
    }));
  }
  cancel(request) {
    const controller = this.#controllers.get(request.operationId);
    if (controller === void 0) return false;
    controller.abort();
    return true;
  }
};

// src/authorization/OperationAuthorization.ts
var boundaryToken = /* @__PURE__ */ Symbol("repository-boundary-permit-construction");
var executionToken = /* @__PURE__ */ Symbol("git-execution-permit-construction");
var queueLeaseToken = /* @__PURE__ */ Symbol("participant-queue-lease-construction");
var authorizedToken = /* @__PURE__ */ Symbol("authorized-git-operation-construction");
var boundaryIssuers = /* @__PURE__ */ new WeakMap();
var executionIssuers = /* @__PURE__ */ new WeakMap();
var queueLeaseIssuers = /* @__PURE__ */ new WeakMap();
var authorizedIssuers = /* @__PURE__ */ new WeakMap();
var equalRequiredLock = (left, right) => left.kind === "repository" ? right?.kind === "repository" && left.repoId === right.repoId : right?.kind === "family" && left.familyId === right.familyId;
var RepositoryBoundaryPermit = class {
  constructor(token, planIdentity, planDigest2, participantRepoIds) {
    this.planIdentity = planIdentity;
    this.planDigest = planDigest2;
    this.participantRepoIds = participantRepoIds;
    if (token !== boundaryToken) throw new TypeError("RepositoryBoundaryPermit must be issued by its runtime authority");
    Object.freeze(this);
  }
  planIdentity;
  planDigest;
  participantRepoIds;
};
var RuntimeRepositoryBoundaryPermitAuthority = class {
  #issuerId = /* @__PURE__ */ Symbol("repository-boundary-permit-issuer");
  issue(plan) {
    const participantRepoIds = plan.scope.participants.map((participant) => participant.repoId);
    const permit = new RepositoryBoundaryPermit(boundaryToken, plan.planIdentity, plan.planDigest, Object.freeze(participantRepoIds));
    boundaryIssuers.set(permit, this.#issuerId);
    return permit;
  }
  verify(candidate, plan) {
    if (!(candidate instanceof RepositoryBoundaryPermit) || boundaryIssuers.get(candidate) !== this.#issuerId) return false;
    const expected = plan.scope.participants.map((participant) => participant.repoId);
    return candidate.planIdentity === plan.planIdentity && candidate.planDigest === plan.planDigest && candidate.participantRepoIds.length === expected.length && candidate.participantRepoIds.every((repoId, index) => repoId === expected[index]);
  }
};
var GitExecutionPermit = class {
  constructor(token, planIdentity, planDigest2, profile) {
    this.planIdentity = planIdentity;
    this.planDigest = planDigest2;
    this.profile = profile;
    if (token !== executionToken) throw new TypeError("GitExecutionPermit must be issued by its runtime authority");
    Object.freeze(this);
  }
  planIdentity;
  planDigest;
  profile;
};
var RuntimeGitExecutionPermitAuthority = class {
  #issuerId = /* @__PURE__ */ Symbol("git-execution-permit-issuer");
  issue(plan, profile) {
    const profileSnapshot = Object.freeze({
      trust: profile.trust,
      allowNetwork: profile.allowNetwork,
      allowMutation: profile.allowMutation,
      allowRepositoryDefinedCode: profile.allowRepositoryDefinedCode,
      disabledSurfaces: Object.freeze([...profile.disabledSurfaces])
    });
    const permit = new GitExecutionPermit(executionToken, plan.planIdentity, plan.planDigest, profileSnapshot);
    executionIssuers.set(permit, this.#issuerId);
    return permit;
  }
  verify(candidate, plan) {
    return candidate instanceof GitExecutionPermit && executionIssuers.get(candidate) === this.#issuerId && candidate.planIdentity === plan.planIdentity && candidate.planDigest === plan.planDigest;
  }
};
var ParticipantQueueLease = class {
  constructor(token, planIdentity, planDigest2, participantRepoIds, repositoryFamilyIds, acquisitionOrder, acquiredAt) {
    this.planIdentity = planIdentity;
    this.planDigest = planDigest2;
    this.participantRepoIds = participantRepoIds;
    this.repositoryFamilyIds = repositoryFamilyIds;
    this.acquisitionOrder = acquisitionOrder;
    this.acquiredAt = acquiredAt;
    if (token !== queueLeaseToken) throw new TypeError("ParticipantQueueLease must be issued by its runtime authority");
    Object.freeze(this);
  }
  planIdentity;
  planDigest;
  participantRepoIds;
  repositoryFamilyIds;
  acquisitionOrder;
  acquiredAt;
};
var RuntimeParticipantQueueLeaseAuthority = class {
  constructor(planVerifier) {
    this.planVerifier = planVerifier;
  }
  planVerifier;
  #issuerId = /* @__PURE__ */ Symbol("participant-queue-lease-issuer");
  #activeLockKeys = /* @__PURE__ */ new Set();
  issue(plan, acquiredAt) {
    if (!this.planVerifier.verify(plan)) throw new TypeError("Queue lease requires a runtime-validated operation plan");
    const participantRepoIds = Object.freeze([...plan.requiredLocks.repositoryIds]);
    const familyIds = Object.freeze([...plan.requiredLocks.familyIds]);
    const acquisitionOrder = Object.freeze(plan.requiredLocks.acquisitionOrder.map(
      (lock) => lock.kind === "repository" ? Object.freeze({ kind: "repository", repoId: lock.repoId }) : Object.freeze({ kind: "family", familyId: lock.familyId })
    ));
    const lockKeys = acquisitionOrder.map((lock) => lock.kind === "repository" ? `repository:${lock.repoId}` : `family:${lock.familyId}`);
    if (lockKeys.some((key) => this.#activeLockKeys.has(key))) throw new TypeError("Participant or repository-family queue lease overlaps an active operation");
    lockKeys.forEach((key) => this.#activeLockKeys.add(key));
    const lease = new ParticipantQueueLease(queueLeaseToken, plan.planIdentity, plan.planDigest, participantRepoIds, familyIds, acquisitionOrder, acquiredAt);
    queueLeaseIssuers.set(lease, { issuerId: this.#issuerId, lockKeys, active: true });
    return lease;
  }
  verifyActive(candidate, plan) {
    if (!(candidate instanceof ParticipantQueueLease)) return false;
    const state = queueLeaseIssuers.get(candidate);
    if (state?.issuerId !== this.#issuerId || !state.active) return false;
    const lockOrderMatches = candidate.acquisitionOrder.length === plan.requiredLocks.acquisitionOrder.length && candidate.acquisitionOrder.every((lock, index) => equalRequiredLock(lock, plan.requiredLocks.acquisitionOrder[index]));
    return candidate.planIdentity === plan.planIdentity && candidate.planDigest === plan.planDigest && candidate.participantRepoIds.length === plan.requiredLocks.repositoryIds.length && candidate.participantRepoIds.every((repoId, index) => repoId === plan.requiredLocks.repositoryIds[index]) && candidate.repositoryFamilyIds.length === plan.requiredLocks.familyIds.length && candidate.repositoryFamilyIds.every((familyId, index) => familyId === plan.requiredLocks.familyIds[index]) && lockOrderMatches;
  }
  release(candidate) {
    const state = queueLeaseIssuers.get(candidate);
    if (state?.issuerId !== this.#issuerId || !state.active) throw new TypeError("Queue lease is not active for this authority");
    state.active = false;
    state.lockKeys.forEach((key) => this.#activeLockKeys.delete(key));
  }
};
var AuthorizedGitOperation = class {
  constructor(token, plan, boundaryPermit, executionPermit, queueLease) {
    this.plan = plan;
    this.boundaryPermit = boundaryPermit;
    this.executionPermit = executionPermit;
    this.queueLease = queueLease;
    if (token !== authorizedToken) throw new TypeError("AuthorizedGitOperation must be issued by its runtime authority");
    Object.freeze(this);
  }
  plan;
  boundaryPermit;
  executionPermit;
  queueLease;
};
var RuntimeAuthorizedGitOperationAuthority = class {
  constructor(planAuthority, boundaryAuthority, executionAuthority, queueLeaseAuthority) {
    this.planAuthority = planAuthority;
    this.boundaryAuthority = boundaryAuthority;
    this.executionAuthority = executionAuthority;
    this.queueLeaseAuthority = queueLeaseAuthority;
  }
  planAuthority;
  boundaryAuthority;
  executionAuthority;
  queueLeaseAuthority;
  #issuerId = /* @__PURE__ */ Symbol("authorized-git-operation-issuer");
  issue(plan, boundaryPermit, executionPermit, queueLease) {
    if (!this.planAuthority.verify(plan) || !this.boundaryAuthority.verify(boundaryPermit, plan) || !this.executionAuthority.verify(executionPermit, plan) || !this.queueLeaseAuthority.verifyActive(queueLease, plan)) throw new TypeError("Authorization evidence does not match the validated plan");
    const authorized = new AuthorizedGitOperation(authorizedToken, plan, boundaryPermit, executionPermit, queueLease);
    authorizedIssuers.set(authorized, this.#issuerId);
    return authorized;
  }
  verifyFor(candidate, expectedRepoId, expectedKind) {
    return candidate instanceof AuthorizedGitOperation && authorizedIssuers.get(candidate) === this.#issuerId && this.planAuthority.verify(candidate.plan) && candidate.plan.repoId === expectedRepoId && candidate.plan.kind === expectedKind && this.boundaryAuthority.verify(candidate.boundaryPermit, candidate.plan) && this.executionAuthority.verify(candidate.executionPermit, candidate.plan) && this.queueLeaseAuthority.verifyActive(candidate.queueLease, candidate.plan);
  }
};

// src/domain/OperationTypes.ts
var noEffects = {
  network: false,
  mutatesWorktree: false,
  mutatesIndex: false,
  mutatesGitConfig: false,
  mutatesGitMetadata: false,
  mutatesLocalRefs: false,
  mutatesRemoteRefs: false,
  destructive: false
};
var effects = (overrides) => ({ ...noEffects, ...overrides });
var OPERATION_EFFECTS = {
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
};
var hasMutationEffects = (value) => value.mutatesWorktree || value.mutatesIndex || value.mutatesGitConfig || value.mutatesGitMetadata || value.mutatesLocalRefs || value.mutatesRemoteRefs;
function assertTrustedEffects(kind, actual) {
  const expected = OPERATION_EFFECTS[kind];
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`Operation effects shape mismatch for ${kind}`);
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) throw new Error(`Operation effects mismatch for ${kind}:${key}`);
  }
}

// src/core/ReadOnlyRepositoryBoundaryPolicy.ts
var ReadOnlyRepositoryBoundaryPolicy = class {
  constructor(planVerifier, permitAuthority) {
    this.planVerifier = planVerifier;
    this.permitAuthority = permitAuthority;
  }
  planVerifier;
  permitAuthority;
  authorize(plan) {
    if (!this.planVerifier.verify(plan)) return { allowed: false, code: "relation-mismatch", reason: "Plan provenance or relation locks are invalid" };
    if (hasMutationEffects(plan.effects)) return { allowed: false, code: "cross-context-boundary", reason: "Stage 2 permits read-only plans only" };
    return { allowed: true, permit: this.permitAuthority.issue(plan) };
  }
};

// src/git/GitErrors.ts
var GitRuntimeError = class extends Error {
  constructor(code, message, diagnostics, exitCode = null, stderr = "") {
    super(message);
    this.code = code;
    this.diagnostics = diagnostics;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.name = "GitRuntimeError";
  }
  code;
  diagnostics;
  exitCode;
  stderr;
};

// src/git/infrastructure/PorcelainV2Parser.ts
var decoder = new TextDecoder("utf-8", { fatal: true });
var decode = (value) => decoder.decode(value);
var asPath = (value) => decode(value);
var splitNul = (input) => {
  const records = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) if (input[index] === 0) {
    records.push(input.subarray(start, index));
    start = index + 1;
  }
  if (start !== input.length) throw new TypeError("Porcelain v2 -z output is not NUL terminated");
  return records;
};
var splitAsciiPrefix = (record, fieldCount) => {
  const fields = [];
  let start = 0;
  for (let index = 0; index < record.length && fields.length < fieldCount; index += 1) if (record[index] === 32) {
    fields.push(decode(record.subarray(start, index)));
    start = index + 1;
  }
  if (fields.length !== fieldCount) throw new TypeError("Malformed porcelain v2 record");
  return { fields, rest: record.subarray(start) };
};
var indexStatus = (value) => ({ ".": "unmodified", " ": "unmodified", A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type-changed", U: "unmerged" })[value] ?? (() => {
  throw new TypeError(`Unknown index status ${value}`);
})();
var worktreeStatus = (value) => ({ ".": "unmodified", " ": "unmodified", M: "modified", D: "deleted", T: "type-changed", U: "unmerged" })[value] ?? (() => {
  throw new TypeError(`Unknown worktree status ${value}`);
})();
var submoduleStatus = (value) => value.startsWith("S") ? {
  commitChanged: value[1] === "C",
  trackedChanges: value[2] === "M",
  untrackedChanges: value[3] === "U"
} : void 0;
var stage = (mode, objectId) => /^0+$/u.test(mode) || /^0+$/u.test(objectId) ? void 0 : { mode, objectId };
var parsePorcelainV2Status = (repositoryId, input, observedAt, diagnostics) => {
  try {
    const records = splitNul(input);
    const files = [];
    let head = null;
    let detached = false;
    let upstream = null;
    let ahead = 0;
    let behind = 0;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record === void 0 || record.length === 0) continue;
      if (record[0] === 35) {
        const header = decode(record);
        if (header.startsWith("# branch.head ")) {
          const value = header.slice(14);
          detached = value === "(detached)";
          head = detached || value === "(unknown)" ? null : value;
        } else if (header.startsWith("# branch.upstream ")) upstream = header.slice(18);
        else if (header.startsWith("# branch.ab ")) {
          const match = /^# branch\.ab \+(\d+) -(\d+)$/u.exec(header);
          if (match !== null) {
            ahead = Number(match[1]);
            behind = Number(match[2]);
          }
        }
        continue;
      }
      const marker = String.fromCharCode(record[0] ?? 0);
      if (marker === "?") {
        files.push({ path: asPath(record.subarray(2)), indexStatus: "unmodified", worktreeStatus: "unmodified", untracked: true, changeKind: "untracked" });
        continue;
      }
      if (marker === "1") {
        const { fields, rest } = splitAsciiPrefix(record, 8);
        const xy = fields[1] ?? "..";
        const submodule = submoduleStatus(fields[2] ?? "N...");
        files.push({ path: asPath(rest), indexStatus: indexStatus(xy[0] ?? "."), worktreeStatus: worktreeStatus(xy[1] ?? "."), untracked: false, changeKind: "ordinary", ...submodule === void 0 ? {} : { submoduleState: submodule } });
        continue;
      }
      if (marker === "2") {
        const { fields, rest } = splitAsciiPrefix(record, 9);
        const original = records[index + 1];
        if (original === void 0) throw new TypeError("Rename/copy record has no original pathname");
        index += 1;
        const xy = fields[1] ?? "..";
        const scoreField = fields[8] ?? "R0";
        const kind = scoreField.startsWith("C") ? "copy" : "rename";
        const submodule = submoduleStatus(fields[2] ?? "N...");
        files.push({ path: asPath(rest), originalPath: asPath(original), indexStatus: indexStatus(xy[0] ?? "."), worktreeStatus: worktreeStatus(xy[1] ?? "."), untracked: false, changeKind: kind, similarity: Number(scoreField.slice(1)), ...submodule === void 0 ? {} : { submoduleState: submodule } });
        continue;
      }
      if (marker === "u") {
        const { fields, rest } = splitAsciiPrefix(record, 10);
        const xy = fields[1] ?? "UU";
        const base = stage(fields[3] ?? "0", fields[7] ?? "0");
        const ours = stage(fields[4] ?? "0", fields[8] ?? "0");
        const theirs = stage(fields[5] ?? "0", fields[9] ?? "0");
        files.push({ path: asPath(rest), indexStatus: indexStatus(xy[0] ?? "U"), worktreeStatus: worktreeStatus(xy[1] ?? "U"), untracked: false, changeKind: "unmerged", conflictStages: { ...base === void 0 ? {} : { base }, ...ours === void 0 ? {} : { ours }, ...theirs === void 0 ? {} : { theirs } } });
        continue;
      }
      throw new TypeError(`Unsupported porcelain v2 record marker ${marker}`);
    }
    const branch = Object.freeze({ head, detached, upstream, ahead, behind });
    return Object.freeze({ repositoryId, branch, files: Object.freeze(files.map((file) => Object.freeze(file))), observedAt });
  } catch (error) {
    throw new GitRuntimeError("invalid-output", error instanceof Error ? error.message : String(error), diagnostics);
  }
};

// src/git/infrastructure/DesktopGitBackend.ts
var DesktopGitBackend = class {
  constructor(descriptor, runner, authorizationVerifier) {
    this.runner = runner;
    this.authorizationVerifier = authorizationVerifier;
    this.repositoryId = descriptor.repositoryId;
    this.descriptor = descriptor;
    Object.freeze(this);
  }
  runner;
  authorizationVerifier;
  #lastObservedAt = 0;
  runtime = "desktop-system-git";
  repositoryId;
  descriptor;
  async status(operation) {
    if (!this.authorizationVerifier.verifyFor(operation, this.repositoryId, "status")) throw new TypeError("Status operation is not authorized for this backend target");
    const result = await this.runner.runStatus(this.descriptor, operation.plan.operationId, operation.plan.signal, operation.plan.deadlineAt);
    this.#lastObservedAt = Math.max(Date.now(), this.#lastObservedAt + 1);
    return parsePorcelainV2Status(this.repositoryId, result.stdout, this.#lastObservedAt, { repositoryId: this.repositoryId, operationId: operation.plan.operationId, command: "status" });
  }
};

// src/operations/OperationQueue.ts
var RuntimeOperationQueue = class {
  constructor(repositoryId) {
    this.repositoryId = repositoryId;
  }
  repositoryId;
  #waiters = [];
  #locked = false;
  #disposed = false;
  acquire(signal, deadlineAt) {
    if (this.#disposed) return Promise.reject(new Error(`Repository queue ${this.repositoryId} is disposed`));
    if (signal.aborted) return Promise.reject(new DOMException("Queue acquisition cancelled", "AbortError"));
    if (deadlineAt <= Date.now()) return Promise.reject(new Error("Queue acquisition deadline elapsed"));
    if (!this.#locked && this.#waiters.length === 0) {
      this.#locked = true;
      return Promise.resolve(this.#lease());
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, deadlineAt, timer: null, abortListener: null };
      const remove = (error) => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        this.#cleanup(waiter);
        reject(error);
      };
      waiter.abortListener = () => remove(new DOMException("Queue acquisition cancelled", "AbortError"));
      waiter.timer = setTimeout(() => remove(new Error("Queue acquisition deadline elapsed")), Math.max(0, deadlineAt - Date.now()));
      signal.addEventListener("abort", waiter.abortListener, { once: true });
      this.#waiters.push(waiter);
    });
  }
  async enqueue(operation, execute) {
    const lease = await this.acquire(operation.plan.signal, operation.plan.deadlineAt);
    try {
      return await execute(operation.plan);
    } finally {
      lease.release();
    }
  }
  cancel() {
    return false;
  }
  async dispose(repoId) {
    if (repoId !== this.repositoryId) throw new TypeError("Cannot dispose a queue through another repository context");
    this.#disposed = true;
    for (const waiter of this.#waiters.splice(0)) {
      this.#cleanup(waiter);
      waiter.reject(new Error(`Repository queue ${this.repositoryId} was disposed`));
    }
    await Promise.resolve();
  }
  #lease() {
    let active = true;
    return Object.freeze({ release: () => {
      if (!active) throw new TypeError("Operation queue lease already released");
      active = false;
      this.#advance();
    } });
  }
  #advance() {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (waiter === void 0) break;
      this.#cleanup(waiter);
      if (waiter.signal.aborted || waiter.deadlineAt <= Date.now()) {
        waiter.reject(waiter.signal.aborted ? new DOMException("Queue acquisition cancelled", "AbortError") : new Error("Queue acquisition deadline elapsed"));
        continue;
      }
      waiter.resolve(this.#lease());
      return;
    }
    this.#locked = false;
  }
  #cleanup(waiter) {
    if (waiter.timer !== null) clearTimeout(waiter.timer);
    if (waiter.abortListener !== null) waiter.signal.removeEventListener("abort", waiter.abortListener);
  }
};

// src/state/RepoStore.ts
var RuntimeRepoStore = class {
  constructor(repositoryId, clock = Date.now) {
    this.repositoryId = repositoryId;
    this.clock = clock;
  }
  repositoryId;
  clock;
  #lifecycle = "ready";
  #snapshot = null;
  #currentOperation = null;
  #lastError = null;
  get lifecycle() {
    return this.#lifecycle;
  }
  get snapshot() {
    return this.#snapshot;
  }
  get currentOperation() {
    return this.#currentOperation;
  }
  get lastError() {
    return this.#lastError;
  }
  applyObservation(observation) {
    if (observation.repositoryId !== this.repositoryId) throw new TypeError("Observation belongs to another repository");
    if (this.#snapshot !== null && observation.observedAt <= this.#snapshot.observation.observedAt) return false;
    this.#snapshot = Object.freeze({ observation, generation: (this.#snapshot?.generation ?? 0) + 1, confidence: "authoritative", appliedAt: this.clock() });
    this.#lifecycle = "ready";
    this.#lastError = null;
    return true;
  }
  markStale(repoId) {
    this.#assertRepo(repoId);
    if (this.#snapshot !== null) this.#snapshot = Object.freeze({ ...this.#snapshot, confidence: "stale" });
  }
  markUnknown(repoId) {
    this.#assertRepo(repoId);
    if (this.#snapshot !== null) this.#snapshot = Object.freeze({ ...this.#snapshot, confidence: "unknown" });
  }
  markMissing() {
    this.#lifecycle = "missing";
    this.markUnknown(this.repositoryId);
  }
  markReady() {
    this.#lifecycle = "ready";
    this.markStale(this.repositoryId);
  }
  markDisposed() {
    this.#lifecycle = "disposed";
    this.#currentOperation = null;
  }
  beginOperation(operation) {
    this.#currentOperation = operation;
  }
  finishOperation() {
    this.#currentOperation = null;
  }
  fail(error) {
    this.#lastError = Object.freeze({ ...error, repoId: this.repositoryId, occurredAt: this.clock() });
    this.#currentOperation = null;
    this.markStale(this.repositoryId);
  }
  #assertRepo(repoId) {
    if (repoId !== this.repositoryId) throw new TypeError("RepoStore repository isolation violation");
  }
};

// src/core/RepositoryContextFactory.ts
var RuntimeRepositoryContextFactory = class {
  constructor(runner, authorizationVerifier, safetyFactory, clock = Date.now) {
    this.runner = runner;
    this.authorizationVerifier = authorizationVerifier;
    this.safetyFactory = safetyFactory;
    this.clock = clock;
  }
  runner;
  authorizationVerifier;
  safetyFactory;
  clock;
  finalize(provisional, probeResult) {
    if (provisional.id !== probeResult.repoId || provisional.target.candidateRoot !== probeResult.target.candidateRoot || provisional.target.locator.kind !== probeResult.target.locator.kind) {
      throw new TypeError("Probe result does not belong to provisional context");
    }
    const descriptor = Object.freeze({
      repositoryId: provisional.id,
      familyId: probeResult.familyId,
      name: provisional.target.displayPath.split("/").at(-1) ?? provisional.id,
      locator: Object.freeze({ ...provisional.target.locator }),
      runtimeRoot: probeResult.runtimeRoot,
      displayPath: provisional.target.displayPath,
      gitDir: probeResult.gitDir,
      commonDir: probeResult.commonDir,
      superprojectRoot: probeResult.superprojectRoot,
      objectFormat: probeResult.objectFormat,
      aliases: Object.freeze([])
    });
    return Object.freeze({
      id: provisional.id,
      descriptor,
      backend: new DesktopGitBackend(descriptor, this.runner, this.authorizationVerifier),
      store: new RuntimeRepoStore(provisional.id, this.clock),
      queue: new RuntimeOperationQueue(provisional.id),
      safety: this.safetyFactory(provisional.id),
      metadata: Object.freeze({ discoveredAt: this.clock(), source: provisional.target.locator.kind === "external" ? "external" : provisional.target.locator.kind === "submodule" ? "submodule" : "vault-plugin", trust: "untrusted" })
    });
  }
};

// src/core/RepositoryRegistry.ts
var RuntimeRepositoryRegistry = class {
  constructor(factory) {
    this.factory = factory;
  }
  factory;
  #records = /* @__PURE__ */ new Map();
  #listeners = /* @__PURE__ */ new Set();
  registerProvisional(context) {
    if (this.#records.has(context.id)) throw new TypeError(`Repository ${context.id} is already registered`);
    this.#records.set(context.id, Object.freeze({ lifecycle: "provisional", provisional: context }));
  }
  finalize(repoId, result) {
    const record = this.#records.get(repoId);
    if (record?.lifecycle !== "provisional") throw new TypeError(`Repository ${repoId} is not provisional`);
    const context = this.factory.finalize(record.provisional, result);
    this.#records.set(repoId, Object.freeze({ lifecycle: "ready", context }));
    this.#emit({ kind: "added", repoId });
    return context;
  }
  get(repoId) {
    const record = this.#records.get(repoId);
    return record?.lifecycle === "ready" ? record.context : void 0;
  }
  getRequired(repoId) {
    const context = this.get(repoId);
    if (context === void 0) throw new TypeError(`Repository ${repoId} is not ready`);
    return context;
  }
  list() {
    return Object.freeze([...this.#records.values()].flatMap((record) => record.lifecycle === "ready" || record.lifecycle === "missing" ? [record.context] : []).sort((left, right) => left.id.localeCompare(right.id)));
  }
  records() {
    return Object.freeze([...this.#records.values()]);
  }
  markMissing(repoId) {
    const record = this.#records.get(repoId);
    if (record?.lifecycle !== "ready") return;
    record.context.store.markMissing();
    this.#records.set(repoId, Object.freeze({ lifecycle: "missing", context: record.context }));
    this.#emit({ kind: "missing", repoId });
  }
  restore(repoId) {
    const record = this.#records.get(repoId);
    if (record?.lifecycle !== "missing") return;
    record.context.store.markReady();
    this.#records.set(repoId, Object.freeze({ lifecycle: "ready", context: record.context }));
    this.#emit({ kind: "returned", repoId });
  }
  async dispose(repoId) {
    const record = this.#records.get(repoId);
    if (record === void 0 || record.lifecycle === "disposed") return;
    if (record.lifecycle === "ready" || record.lifecycle === "missing") {
      await record.context.queue.dispose(record.context.id);
      record.context.store.markDisposed();
    }
    this.#records.set(repoId, Object.freeze({ lifecycle: "disposed", repoId }));
    this.#emit({ kind: "removed", repoId });
  }
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }
};

// src/domain/PathSemantics.ts
var pathContains = (root, candidate) => candidate === root || candidate.startsWith(`${root}/`);

// src/core/RepositoryRelationGraph.ts
var RuntimeRepositoryRelationGraph = class {
  #descriptors = /* @__PURE__ */ new Map();
  replace(descriptors) {
    this.#descriptors = new Map(descriptors.map((descriptor) => [descriptor.repositoryId, descriptor]));
  }
  relation(left, right) {
    const leftDescriptor = this.#required(left);
    const rightDescriptor = this.#required(right);
    if (leftDescriptor.commonDir === rightDescriptor.commonDir && left !== right) return { kind: "shared-common-dir", left, right, familyId: leftDescriptor.familyId, commonDir: leftDescriptor.commonDir };
    if (leftDescriptor.superprojectRoot === rightDescriptor.runtimeRoot) return { kind: "submodule-of", child: left, superproject: right, path: leftDescriptor.runtimeRoot.slice(rightDescriptor.runtimeRoot.length + 1) };
    if (rightDescriptor.superprojectRoot === leftDescriptor.runtimeRoot) return { kind: "superproject-of", superproject: left, submodule: right, path: rightDescriptor.runtimeRoot.slice(leftDescriptor.runtimeRoot.length + 1) };
    if (pathContains(leftDescriptor.runtimeRoot, rightDescriptor.runtimeRoot)) return { kind: "nested", parent: left, child: right };
    if (pathContains(rightDescriptor.runtimeRoot, leftDescriptor.runtimeRoot)) return { kind: "nested", parent: right, child: left };
    return { kind: "disjoint", left, right };
  }
  related(repoId) {
    return [...this.#descriptors.keys()].filter((other) => other !== repoId).map((other) => this.relation(repoId, other));
  }
  family(repoId) {
    const descriptor = this.#descriptors.get(repoId);
    if (descriptor === void 0) return null;
    const members = [...this.#descriptors.values()].filter((candidate) => candidate.commonDir === descriptor.commonDir).map((candidate) => candidate.repositoryId).sort((left, right) => left.localeCompare(right));
    if (members.length === 0) return null;
    return { id: descriptor.familyId, commonDir: descriptor.commonDir, members };
  }
  areByteIsolated(left, right) {
    return this.relation(left, right).kind === "disjoint";
  }
  nestedPathOwnership() {
    return "unknown";
  }
  #required(repoId) {
    const value = this.#descriptors.get(repoId);
    if (value === void 0) throw new TypeError(`Unknown repository ${repoId}`);
    return value;
  }
};

// src/git/infrastructure/DesktopRepositoryDiscovery.ts
var import_node_crypto3 = require("node:crypto");
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");

// src/git/infrastructure/CanonicalPath.ts
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var normalizePlatformCase = (value) => {
  if (process.platform !== "win32") return value;
  const root = (0, import_node_path.parse)(value).root;
  return root.length === 0 ? value : `${root.toLocaleLowerCase("en-US")}${value.slice(root.length)}`;
};
var normalizeCanonicalPath = (value) => {
  if (!(0, import_node_path.isAbsolute)(value)) throw new TypeError(`Expected absolute path: ${value}`);
  const normalized = normalizePlatformCase((0, import_node_path.normalize)(value)).split(import_node_path.sep).join("/");
  return normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized;
};
var canonicalizeExistingPath = async (value) => normalizeCanonicalPath(await (0, import_promises.realpath)(value));

// src/git/infrastructure/DesktopRepositoryProbeBackend.ts
var import_node_crypto2 = require("node:crypto");
var familyIdFor = (commonDir) => `family:${(0, import_node_crypto2.createHash)("sha256").update(commonDir).digest("hex")}`;
var DesktopRepositoryProbeBackend = class {
  constructor(target, runner, planVerifier) {
    this.runner = runner;
    this.planVerifier = planVerifier;
    this.repositoryId = target.repoId;
    this.target = Object.freeze({ ...target, locator: Object.freeze({ ...target.locator }) });
    Object.freeze(this);
  }
  runner;
  planVerifier;
  runtime = "desktop-system-git-probe";
  repositoryId;
  target;
  async probe(plan) {
    if (!this.planVerifier.verify(plan) || plan.repoId !== this.repositoryId) {
      throw new TypeError("Probe requires a genuine validated plan for its immutable candidate target");
    }
    const layout = await this.runner.runProbe(this.target, plan.operationId, "probe-layout", plan.signal, plan.deadlineAt);
    const lines = new TextDecoder().decode(layout.stdout).replace(/\r\n/gu, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (lines.length < 4) throw new GitRuntimeError("invalid-output", "Git probe returned an incomplete repository layout", { repositoryId: this.repositoryId, operationId: plan.operationId, command: "probe-layout" });
    const [rootText, gitDirText, commonDirText, insideText, superprojectText = ""] = lines;
    if (rootText === void 0 || gitDirText === void 0 || commonDirText === void 0 || insideText !== "true") {
      throw new GitRuntimeError("invalid-output", "Candidate is not inside a Git worktree", { repositoryId: this.repositoryId, operationId: plan.operationId, command: "probe-layout" });
    }
    const [candidateRoot, runtimeRoot, gitDir, commonDir] = await Promise.all([
      canonicalizeExistingPath(this.target.candidateRoot),
      canonicalizeExistingPath(rootText),
      canonicalizeExistingPath(gitDirText),
      canonicalizeExistingPath(commonDirText)
    ]);
    if (candidateRoot !== runtimeRoot) {
      throw new GitRuntimeError("candidate-root-mismatch", `Candidate ${candidateRoot} resolves to ancestor repository ${runtimeRoot}`, { repositoryId: this.repositoryId, operationId: plan.operationId, command: "probe-layout" });
    }
    const superprojectRoot = superprojectText.length === 0 ? null : await canonicalizeExistingPath(superprojectText);
    const formatResult = await this.runner.runProbe(this.target, plan.operationId, "probe-object-format", plan.signal, plan.deadlineAt);
    const format = new TextDecoder().decode(formatResult.stdout).trim();
    if (format !== "sha1" && format !== "sha256") throw new GitRuntimeError("invalid-output", `Unsupported Git object format: ${format}`, { repositoryId: this.repositoryId, operationId: plan.operationId, command: "probe-object-format" });
    return Object.freeze({ repoId: this.repositoryId, target: this.target, runtimeRoot, gitDir, commonDir, familyId: familyIdFor(commonDir), objectFormat: format, isInsideWorkTree: true, superprojectRoot });
  }
};

// src/git/infrastructure/DesktopRepositoryDiscovery.ts
var DesktopRepositoryDiscovery = class {
  constructor(options) {
    this.options = options;
    this.#clock = options.clock ?? Date.now;
  }
  options;
  #clock;
  async discover(signal) {
    const startedAt = this.#clock();
    const pluginsRoot = (0, import_node_path2.join)(this.options.vaultRoot, this.options.configDir, "plugins");
    const directoryEntries = (await (0, import_promises2.readdir)(pluginsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name));
    const reportEntries = [];
    const roots = /* @__PURE__ */ new Set();
    for (const entry of directoryEntries) {
      if (signal.aborted) throw new DOMException("Repository discovery cancelled", "AbortError");
      const candidateRoot = await canonicalizeExistingPath((0, import_node_path2.join)(pluginsRoot, entry.name));
      const relativePath = import_node_path2.posix.join(this.options.configDir.replaceAll("\\", "/"), "plugins", entry.name);
      const locator = Object.freeze({ kind: "vault-relative", relativePath });
      const repoId = await this.options.identityStore.getOrCreate(locator);
      const displayPath = relativePath;
      const target = Object.freeze({ repoId, locator, candidateRoot, displayPath });
      const probeBackend = new DesktopRepositoryProbeBackend(target, this.options.runner, this.options.planVerifier);
      const provisional = Object.freeze({ id: repoId, lifecycle: "probing", target, probeBackend });
      this.options.registry.registerProvisional(provisional);
      const intent = { repoId, operationId: (0, import_node_crypto3.randomUUID)(), kind: "probe", payload: {}, origin: "system", signal, deadlineAt: this.#clock() + 3e4 };
      try {
        const plan = await this.options.planner.plan(intent);
        const result = await probeBackend.probe(plan);
        if (roots.has(result.runtimeRoot)) {
          reportEntries.push(Object.freeze({ repoId, displayPath, candidateRoot, result: "duplicate", runtimeRoot: result.runtimeRoot, errorCode: "duplicate-root", message: "Canonical repository root was already discovered" }));
          await this.options.registry.dispose(repoId);
          continue;
        }
        roots.add(result.runtimeRoot);
        this.options.registry.finalize(repoId, result);
        reportEntries.push(Object.freeze({ repoId, displayPath, candidateRoot, result: "accepted", runtimeRoot: result.runtimeRoot, errorCode: null, message: null }));
      } catch (error) {
        const code = error instanceof GitRuntimeError ? error.code : "probe-failed";
        reportEntries.push(Object.freeze({ repoId, displayPath, candidateRoot, result: "rejected", runtimeRoot: null, errorCode: code, message: error instanceof Error ? error.message : String(error) }));
        await this.options.registry.dispose(repoId);
      }
    }
    this.options.relationGraph.replace(this.options.registry.list().map((context) => context.descriptor));
    return Object.freeze({ pluginsRoot, startedAt, completedAt: this.#clock(), entries: Object.freeze(reportEntries) });
  }
};

// src/git/infrastructure/GitCapabilityService.ts
var processWideCapability = null;
var GitCapabilityService = class {
  constructor(runner) {
    this.runner = runner;
  }
  runner;
  check(signal) {
    processWideCapability ??= this.runner.checkCapability(signal).catch((error) => {
      processWideCapability = null;
      throw error;
    });
    return processWideCapability;
  }
};

// src/git/infrastructure/GitCommandRunner.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var GLOBAL_READ_ONLY_ARGUMENTS = Object.freeze([
  "--no-pager",
  "--no-optional-locks",
  "-c",
  "core.hooksPath=",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "credential.helper=",
  "-c",
  "core.sshCommand=",
  "-c",
  "diff.external=",
  "-c",
  "submodule.recurse=false"
]);
var STAGE_TWO_REPOSITORY_COMMANDS = Object.freeze({
  "probe-layout": Object.freeze(["rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir", "--is-inside-work-tree", "--show-superproject-working-tree"]),
  "probe-object-format": Object.freeze(["rev-parse", "--show-object-format"]),
  "execution-config": Object.freeze(["config", "--local", "--null", "--name-only", "--get-regexp", "^(filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver|diff\\..*\\.(command|textconv)|credential(\\..*)?\\.helper|core\\.(hooksPath|sshCommand|fsmonitor))$"]),
  status: Object.freeze(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--ignore-submodules=dirty"])
});
var FORBIDDEN_RETARGET_ARGUMENTS = ["-C", "--git-dir", "--work-tree", "--namespace", "--bare"];
var isRetargetArgument = (argument) => FORBIDDEN_RETARGET_ARGUMENTS.some(
  (forbidden) => argument === forbidden || argument.startsWith(`${forbidden}=`) || forbidden === "-C" && argument.startsWith("-C")
);
var assertReadOnlyArgv = (argv) => {
  if (argv.some(isRetargetArgument)) throw new TypeError("Git repository retargeting arguments are forbidden");
  if (argv.length === 1 && argv[0] === "--version") return;
  let command;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "-c") {
      index += 1;
      continue;
    }
    if (value !== void 0 && !value.startsWith("-")) {
      command = value;
      break;
    }
  }
  if (command !== "rev-parse" && command !== "status" && command !== "config") throw new TypeError("Git command is outside the stage-2 read-only allowlist");
};
var redactSecrets = (value) => value.replace(/:\/\/([^\s/:@]+):([^\s@]+)@/gu, "://$1:[REDACTED]@").replace(/\b(authorization|token|password|passwd|secret)=([^\s]+)/giu, "$1=[REDACTED]").replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/giu, "Bearer [REDACTED]");
var filteredEnvironment = (source) => {
  const result = {};
  for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP"]) {
    const value = source[key];
    if (value !== void 0) result[key] = value;
  }
  result.GIT_TERMINAL_PROMPT = "0";
  result.GIT_OPTIONAL_LOCKS = "0";
  result.GIT_PAGER = "cat";
  result.GIT_CONFIG_NOSYSTEM = "1";
  result.GIT_CONFIG_GLOBAL = import_node_os.devNull;
  result.LC_ALL = "C";
  return result;
};
var DesktopGitCommandRunner = class {
  #gitBinary;
  #timeoutMs;
  #maxStdoutBytes;
  #maxStderrBytes;
  #environment;
  #onInvocation;
  constructor(options = {}) {
    this.#gitBinary = options.gitBinary ?? "git";
    this.#timeoutMs = options.timeoutMs ?? 3e4;
    this.#maxStdoutBytes = options.maxStdoutBytes ?? 16 * 1024 * 1024;
    this.#maxStderrBytes = options.maxStderrBytes ?? 1024 * 1024;
    this.#environment = filteredEnvironment(options.environment ?? process.env);
    this.#onInvocation = options.onInvocation;
  }
  checkCapability(signal) {
    return this.#execute(null, ["--version"], { repositoryId: "process", operationId: "git-capability", command: "git --version" }, signal, Date.now() + this.#timeoutMs).then((result) => new TextDecoder().decode(result.stdout).trim());
  }
  runProbe(target, operationId, command, signal, deadlineAt) {
    return this.#runAt(target.candidateRoot, target.repoId, operationId, command, signal, deadlineAt);
  }
  async runStatus(descriptor, operationId, signal, deadlineAt) {
    const configured = await this.#runAt(descriptor.runtimeRoot, descriptor.repositoryId, operationId, "execution-config", signal, deadlineAt, [0, 1]);
    const keys = new TextDecoder().decode(configured.stdout).split("\0").filter((value) => value.length > 0);
    if (keys.length > 1e3 || keys.some((key) => !/^[A-Za-z0-9.-]+$/u.test(key))) throw new GitRuntimeError("invalid-output", "Unsafe Git execution-surface configuration key", { repositoryId: descriptor.repositoryId, operationId, command: "execution-config" });
    const overrides = keys.flatMap((key) => ["-c", `${key}=`]);
    const argv = [...GLOBAL_READ_ONLY_ARGUMENTS, ...overrides, ...STAGE_TWO_REPOSITORY_COMMANDS.status];
    return this.#execute(descriptor.runtimeRoot, argv, { repositoryId: descriptor.repositoryId, operationId, command: "status" }, signal, deadlineAt, [0]);
  }
  #runAt(cwd, repositoryId, operationId, command, signal, deadlineAt, allowedExitCodes = [0]) {
    const argv = [...GLOBAL_READ_ONLY_ARGUMENTS, ...STAGE_TWO_REPOSITORY_COMMANDS[command]];
    return this.#execute(cwd, argv, { repositoryId, operationId, command }, signal, deadlineAt, allowedExitCodes);
  }
  #execute(cwd, argv, diagnostics, signal, deadlineAt, allowedExitCodes = [0]) {
    assertReadOnlyArgv(argv);
    if (cwd !== null && !(0, import_node_fs.existsSync)(cwd)) return Promise.reject(new GitRuntimeError("repository-missing", "Repository execution root is missing", diagnostics));
    if (signal?.aborted === true) return Promise.reject(new GitRuntimeError("cancelled", "Git operation was cancelled before process start", diagnostics));
    const timeoutMs = Math.min(this.#timeoutMs, deadlineAt - Date.now());
    if (timeoutMs <= 0) return Promise.reject(new GitRuntimeError("timeout", "Git operation deadline elapsed before process start", diagnostics));
    const record = Object.freeze({ repositoryId: diagnostics.repositoryId, operationId: diagnostics.operationId, cwd, argv: Object.freeze([...argv]) });
    this.#onInvocation?.(record);
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = (0, import_node_child_process.spawn)(this.#gitBinary, argv, { cwd: cwd ?? void 0, env: this.#environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        reject(new GitRuntimeError("git-not-found", `Unable to start system Git: ${error instanceof Error ? error.message : String(error)}`, diagnostics));
        return;
      }
      const startedAt = Date.now();
      const stdoutChunks = [];
      const stderrChunks = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminalError = null;
      let settled = false;
      let forceKillTimer = null;
      const terminate = (error) => {
        terminalError ??= error;
        if (!child.killed) {
          child.kill("SIGTERM");
          forceKillTimer ??= setTimeout(() => {
            if (!settled) child.kill("SIGKILL");
          }, 250);
        }
      };
      const timer = setTimeout(() => terminate(new GitRuntimeError("timeout", `Git command exceeded ${timeoutMs}ms`, diagnostics)), timeoutMs);
      const onAbort = () => terminate(new GitRuntimeError("cancelled", "Git operation was cancelled", diagnostics));
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > this.#maxStdoutBytes) terminate(new GitRuntimeError("output-limit", "Git stdout exceeded configured limit", diagnostics));
        else stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > this.#maxStderrBytes) terminate(new GitRuntimeError("output-limit", "Git stderr exceeded configured limit", diagnostics));
        else stderrChunks.push(chunk);
      });
      child.on("error", (error) => {
        terminalError ??= new GitRuntimeError("git-not-found", `Unable to execute system Git: ${error.message}`, diagnostics);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKillTimer !== null) clearTimeout(forceKillTimer);
        signal?.removeEventListener("abort", onAbort);
        const stderr = redactSecrets(Buffer.concat(stderrChunks).toString("utf8"));
        if (terminalError !== null) {
          reject(new GitRuntimeError(terminalError.code, terminalError.message, diagnostics, code, stderr));
          return;
        }
        if (code === null || !allowedExitCodes.includes(code)) {
          const notRepository = /not a git repository/iu.test(stderr);
          reject(new GitRuntimeError(notRepository ? "not-a-repository" : "command-failed", `Git command failed with exit code ${code ?? "unknown"}`, diagnostics, code, stderr));
          return;
        }
        resolve({ stdout: Buffer.concat(stdoutChunks), stderr, durationMs: Date.now() - startedAt });
      });
    });
  }
};

// src/git/infrastructure/ReadOnlyGitExecutionPolicy.ts
var DISABLED_READ_SURFACES = Object.freeze(["hooks", "hooks-path", "fsmonitor", "credential-helper", "ssh-command", "filter", "merge-driver", "external-diff", "textconv", "editor", "pager", "unknown"]);
var ReadOnlyGitExecutionPolicy = class {
  constructor(planVerifier, trustFor, permitAuthority) {
    this.planVerifier = planVerifier;
    this.trustFor = trustFor;
    this.permitAuthority = permitAuthority;
  }
  planVerifier;
  trustFor;
  permitAuthority;
  authorize(plan) {
    if (!this.planVerifier.verify(plan)) return { allowed: false, code: "plan-invalid", reason: "Plan provenance is invalid" };
    if (plan.effects.network || hasMutationEffects(plan.effects)) return { allowed: false, code: "execution-surface-denied", reason: "Stage 2 execution policy permits local read-only Git only" };
    return { allowed: true, permit: this.permitAuthority.issue(plan, { trust: this.trustFor(plan.repoId), allowNetwork: false, allowMutation: false, allowRepositoryDefinedCode: false, disabledSurfaces: DISABLED_READ_SURFACES }) };
  }
};

// src/git/infrastructure/RepositoryIdentityStore.ts
var import_node_crypto4 = require("node:crypto");
var locatorKey = (locator) => locator.kind === "vault-relative" ? `vault:${locator.relativePath}` : locator.kind === "external" ? `external:${locator.locatorId}` : `submodule:${locator.superprojectId}:${locator.relativePath}`;
var PersistentRepositoryIdentityStore = class {
  constructor(data, persist) {
    this.persist = persist;
    for (const [key, value] of Object.entries(data?.identities ?? {})) this.#identities.set(key, value);
  }
  persist;
  #identities = /* @__PURE__ */ new Map();
  async getOrCreate(locator) {
    const key = locatorKey(locator);
    const existing = this.#identities.get(key);
    if (existing !== void 0) return existing;
    const created = (0, import_node_crypto4.randomUUID)();
    this.#identities.set(key, created);
    await this.persist({ identities: Object.freeze(Object.fromEntries(this.#identities)) });
    return created;
  }
};

// src/operations/CrossContextOperationCoordinator.ts
var FamilyLock = class {
  #tail = Promise.resolve();
  async acquire(signal, deadlineAt) {
    if (signal.aborted) throw new DOMException("Family lock acquisition cancelled", "AbortError");
    let releaseGate = () => void 0;
    const gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    const previous = this.#tail;
    this.#tail = previous.then(() => gate);
    let rejectWaiting = () => void 0;
    const waiting = new Promise((_resolve, reject) => {
      rejectWaiting = reject;
    });
    const abortListener = () => rejectWaiting(new DOMException("Family lock acquisition cancelled", "AbortError"));
    const timer = setTimeout(() => rejectWaiting(new Error("Family lock acquisition deadline elapsed")), Math.max(0, deadlineAt - Date.now()));
    signal.addEventListener("abort", abortListener, { once: true });
    try {
      await Promise.race([previous, waiting]);
    } catch (error) {
      releaseGate();
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abortListener);
    }
    let active = true;
    return Object.freeze({ release: () => {
      if (!active) throw new TypeError("Family lock already released");
      active = false;
      releaseGate();
    } });
  }
};
var RuntimeCrossContextOperationCoordinator = class {
  constructor(queueFor, leaseAuthority) {
    this.queueFor = queueFor;
    this.leaseAuthority = leaseAuthority;
  }
  queueFor;
  leaseAuthority;
  #familyLocks = /* @__PURE__ */ new Map();
  async withParticipantQueues(plan, execute) {
    const acquired = [];
    let participantLease = null;
    try {
      for (const lock of plan.requiredLocks.acquisitionOrder) {
        const lease = lock.kind === "repository" ? await this.queueFor(lock.repoId).acquire(plan.signal, plan.deadlineAt) : await this.#familyLock(lock.familyId).acquire(plan.signal, plan.deadlineAt);
        acquired.push(lease);
      }
      participantLease = this.leaseAuthority.issue(plan, Date.now());
      return await execute(participantLease);
    } finally {
      if (participantLease !== null) this.leaseAuthority.release(participantLease);
      for (const lease of acquired.reverse()) lease.release();
    }
  }
  #familyLock(familyId) {
    const existing = this.#familyLocks.get(familyId);
    if (existing !== void 0) return existing;
    const created = new FamilyLock();
    this.#familyLocks.set(familyId, created);
    return created;
  }
};
var RuntimeGitOperationExecutionCoordinator = class {
  constructor(boundaryPolicy, executionPolicy, queueCoordinator, authorizedAuthority) {
    this.boundaryPolicy = boundaryPolicy;
    this.executionPolicy = executionPolicy;
    this.queueCoordinator = queueCoordinator;
    this.authorizedAuthority = authorizedAuthority;
  }
  boundaryPolicy;
  executionPolicy;
  queueCoordinator;
  authorizedAuthority;
  async execute(plan, invokeBackend) {
    const boundary = this.boundaryPolicy.authorize(plan);
    if (!boundary.allowed) throw new TypeError(`Repository boundary authorization denied: ${boundary.reason}`);
    const execution = this.executionPolicy.authorize(plan);
    if (!execution.allowed) throw new TypeError(`Git execution authorization denied: ${execution.reason}`);
    return this.queueCoordinator.withParticipantQueues(plan, async (queueLease) => {
      const authorized = this.authorizedAuthority.issue(plan, boundary.permit, execution.permit, queueLease);
      return invokeBackend(authorized);
    });
  }
};

// src/operations/RuntimeOperationPlanner.ts
var import_node_crypto5 = require("node:crypto");

// src/domain/ValidatedOperationPlan.ts
var planConstructionToken = /* @__PURE__ */ Symbol("validated-operation-plan-construction");
var planIssuers = /* @__PURE__ */ new WeakMap();
var immutableSnapshot = (value) => {
  const snapshot = structuredClone(value);
  const freeze = (candidate) => {
    if (typeof candidate !== "object" || candidate === null || ArrayBuffer.isView(candidate) || Object.isFrozen(candidate)) return;
    for (const key of Reflect.ownKeys(candidate)) {
      const nested = Reflect.get(candidate, key);
      freeze(nested);
    }
    Object.freeze(candidate);
  };
  freeze(snapshot);
  return snapshot;
};
var equalSequence = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
var equalRequiredLock2 = (left, right) => left.kind === "repository" ? right?.kind === "repository" && left.repoId === right.repoId : right?.kind === "family" && left.familyId === right.familyId;
var assertCanonicalRequiredLocks = (data) => {
  const expectedRepositories = [...new Set(data.scope.participants.map((participant) => participant.repoId))].sort((left, right) => left.localeCompare(right));
  const canonicalFamilies = [...new Set(data.requiredLocks.familyIds)].sort((left, right) => left.localeCompare(right));
  const expectedOrder = [
    ...expectedRepositories.map((repoId) => ({ kind: "repository", repoId })),
    ...canonicalFamilies.map((familyId) => ({ kind: "family", familyId }))
  ];
  const orderMatches = data.requiredLocks.acquisitionOrder.length === expectedOrder.length && data.requiredLocks.acquisitionOrder.every((lock, index) => equalRequiredLock2(lock, expectedOrder[index]));
  if (!equalSequence(data.requiredLocks.repositoryIds, expectedRepositories) || !equalSequence(data.requiredLocks.familyIds, canonicalFamilies) || !orderMatches) {
    throw new TypeError("Operation plan required lock set is not canonical");
  }
  if (data.scope.kind === "cross-context" && data.scope.relation === "shared-common-dir" && canonicalFamilies.length === 0) {
    throw new TypeError("Shared-common-dir operation requires a repository-family lock");
  }
};
var ValidatedOperationPlan = class {
  planIdentity;
  planDigest;
  payloadDigest;
  repoId;
  operationId;
  kind;
  payload;
  effects;
  scope;
  requiredLocks;
  origin;
  signal;
  deadlineAt;
  constructor(token, data) {
    if (token !== planConstructionToken) throw new TypeError("ValidatedOperationPlan must be issued by its runtime authority");
    this.planIdentity = data.planIdentity;
    this.planDigest = data.planDigest;
    this.payloadDigest = data.payloadDigest;
    this.repoId = data.repoId;
    this.operationId = data.operationId;
    this.kind = data.kind;
    this.payload = data.payload;
    this.effects = data.effects;
    this.scope = data.scope;
    this.requiredLocks = data.requiredLocks;
    this.origin = data.origin;
    this.signal = data.signal;
    this.deadlineAt = data.deadlineAt;
    Object.freeze(this);
  }
};
var RuntimeValidatedOperationPlanAuthority = class {
  constructor(integrityVerifier) {
    this.integrityVerifier = integrityVerifier;
  }
  integrityVerifier;
  #issuerId = /* @__PURE__ */ Symbol("validated-operation-plan-issuer");
  issue(data) {
    const snapshot = {
      ...data,
      payload: immutableSnapshot(data.payload),
      effects: immutableSnapshot(data.effects),
      scope: immutableSnapshot(data.scope),
      requiredLocks: immutableSnapshot(data.requiredLocks)
    };
    assertTrustedEffects(snapshot.kind, snapshot.effects);
    assertCanonicalRequiredLocks(snapshot);
    if (!this.integrityVerifier.verifyPlanDigestAndRequiredLocks(snapshot)) throw new TypeError("Operation plan integrity verification failed");
    const plan = new ValidatedOperationPlan(planConstructionToken, snapshot);
    planIssuers.set(plan, this.#issuerId);
    return plan;
  }
  verify(candidate) {
    if (!(candidate instanceof ValidatedOperationPlan) || planIssuers.get(candidate) !== this.#issuerId) return false;
    return Object.isFrozen(candidate) && this.integrityVerifier.verifyPlanDigestAndRequiredLocks(candidate);
  }
};

// src/operations/RuntimeOperationPlanner.ts
var stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stableValue(nested)]));
  return value;
};
var digest = (value) => (0, import_node_crypto5.createHash)("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
var payloadDigest = (payload) => digest(payload);
var planDigest = (data) => digest(data);
var noImpact = (repoId) => ({
  repoId,
  worktree: { scope: "none", paths: [] },
  index: { scope: "none", paths: [] },
  gitConfig: { scope: "none", keys: [] },
  gitMetadata: { scope: "none", namespaces: [] },
  localRefs: { scope: "none", refs: [] },
  remoteRefs: { scope: "none", targets: [] }
});
var RuntimeOperationPlanIntegrityVerifier = class {
  constructor(topology) {
    this.topology = topology;
  }
  topology;
  verifyPlanDigestAndRequiredLocks(plan) {
    const repositoryIds = [...new Set(plan.scope.participants.map((participant) => participant.repoId))].sort((left, right) => left.localeCompare(right));
    const familyIds = [...new Set(repositoryIds.flatMap((repoId) => {
      const family = this.topology.family(repoId);
      return family !== null && family.memberCount > 1 ? [family.familyId] : [];
    }))].sort((left, right) => left.localeCompare(right));
    if (repositoryIds.length !== plan.requiredLocks.repositoryIds.length || repositoryIds.some((id, index) => id !== plan.requiredLocks.repositoryIds[index])) return false;
    if (familyIds.length !== plan.requiredLocks.familyIds.length || familyIds.some((id, index) => id !== plan.requiredLocks.familyIds[index])) return false;
    const digestible = {
      planIdentity: plan.planIdentity,
      payloadDigest: plan.payloadDigest,
      repoId: plan.repoId,
      operationId: plan.operationId,
      kind: plan.kind,
      payload: plan.payload,
      effects: plan.effects,
      scope: plan.scope,
      requiredLocks: plan.requiredLocks,
      origin: plan.origin,
      deadlineAt: plan.deadlineAt
    };
    return plan.planDigest === planDigest(digestible);
  }
};
var RuntimeOperationPlanner = class {
  constructor(topology) {
    this.topology = topology;
    this.authority = new RuntimeValidatedOperationPlanAuthority(new RuntimeOperationPlanIntegrityVerifier(topology));
  }
  topology;
  authority;
  plan(intent) {
    if (intent.kind !== "probe" && intent.kind !== "status") return Promise.reject(new TypeError(`Operation ${intent.kind} is outside the stage-2 read-only planner allowlist`));
    const family = this.topology.family(intent.repoId);
    const familyIds = family !== null && family.memberCount > 1 ? [family.familyId] : [];
    const repositoryIds = [intent.repoId];
    const acquisitionOrder = [
      { kind: "repository", repoId: intent.repoId },
      ...familyIds.map((familyId) => ({ kind: "family", familyId }))
    ];
    const identity = (0, import_node_crypto5.randomUUID)();
    const payloadHash = payloadDigest(intent.payload);
    const base = {
      planIdentity: identity,
      payloadDigest: payloadHash,
      repoId: intent.repoId,
      operationId: intent.operationId,
      kind: intent.kind,
      payload: intent.payload,
      effects: OPERATION_EFFECTS[intent.kind],
      scope: { kind: "single-context", participants: [{ repoId: intent.repoId, impact: noImpact(intent.repoId) }] },
      requiredLocks: { repositoryIds, familyIds, acquisitionOrder },
      origin: intent.origin,
      deadlineAt: intent.deadlineAt
    };
    const data = { ...base, signal: intent.signal, planDigest: planDigest(base) };
    return Promise.resolve(this.authority.issue(data));
  }
};

// src/safety/StageTwoUnavailableSafetyFacade.ts
var unavailable = () => Promise.reject(new TypeError("Mutating and destructive Git operations are unavailable in stage 2"));
var StageTwoUnavailableSafetyFacade = class {
  constructor(repositoryId) {
    this.repositoryId = repositoryId;
  }
  repositoryId;
  execute(plan) {
    void plan;
    return unavailable();
  }
  pullRebase(plan) {
    void plan;
    return unavailable();
  }
  amendCommit(plan) {
    void plan;
    return unavailable();
  }
  discardPaths(plan) {
    void plan;
    return unavailable();
  }
  discardAll(plan) {
    void plan;
    return unavailable();
  }
  resetHunk(plan) {
    void plan;
    return unavailable();
  }
  resetHard(plan) {
    void plan;
    return unavailable();
  }
  clean(plan) {
    void plan;
    return unavailable();
  }
  forceCheckout(plan) {
    void plan;
    return unavailable();
  }
  forceDeleteBranch(plan) {
    void plan;
    return unavailable();
  }
  abortOperation(plan) {
    void plan;
    return unavailable();
  }
  forceUpdateRemoteRef(plan) {
    void plan;
    return unavailable();
  }
};

// src/ui/RepositoryDiagnosticsModal.ts
var import_obsidian = require("obsidian");
var RepositoryDiagnosticsModal = class extends import_obsidian.Modal {
  constructor(app, repositories) {
    super(app);
    this.repositories = repositories;
  }
  repositories;
  onOpen() {
    this.setTitle("Git repositories");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: "Refreshing read-only repository status\u2026" });
    void this.repositories.refreshAll().finally(() => this.#render());
  }
  #render() {
    this.contentEl.empty();
    const repositories = this.repositories.list();
    if (repositories.length === 0) {
      this.contentEl.createEl("p", { text: "No Git repositories found in the plugin directory." });
      return;
    }
    for (const repository of repositories) {
      const section = this.contentEl.createDiv({ cls: "git-repository-diagnostic" });
      section.createEl("h3", { text: repository.displayPath });
      section.createEl("code", { text: repository.rootPath });
      section.createEl("p", { text: `${repository.branch}${repository.upstream === null ? "" : ` \u2192 ${repository.upstream}`} \xB7 staged ${repository.staged} \xB7 unstaged ${repository.unstaged} \xB7 untracked ${repository.untracked} \xB7 conflicts ${repository.conflicts} \xB7 \u2191${repository.ahead} \u2193${repository.behind}` });
      if (repository.error !== null) section.createEl("p", { text: `Error: ${repository.error}`, cls: "mod-warning" });
    }
  }
};

// src/composition/PluginRuntime.ts
var PluginRuntime = class _PluginRuntime {
  constructor(plugin, registry, controller, gitVersion) {
    this.plugin = plugin;
    this.registry = registry;
    this.controller = controller;
    this.gitVersion = gitVersion;
  }
  plugin;
  registry;
  controller;
  gitVersion;
  static async create(plugin) {
    const adapter = plugin.app.vault.adapter;
    if (!(adapter instanceof import_obsidian2.FileSystemAdapter)) throw new TypeError("Stage 2 desktop Git requires a filesystem-backed Obsidian vault");
    const runner = new DesktopGitCommandRunner();
    const gitVersion = await new GitCapabilityService(runner).check();
    const relationGraph = new RuntimeRepositoryRelationGraph();
    const planner = new RuntimeOperationPlanner({ family: (repoId) => {
      const family = relationGraph.family(repoId);
      return family === null ? null : { familyId: family.id, memberCount: family.members.length };
    } });
    const boundaryPermitAuthority = new RuntimeRepositoryBoundaryPermitAuthority();
    const executionPermitAuthority = new RuntimeGitExecutionPermitAuthority();
    const participantLeaseAuthority = new RuntimeParticipantQueueLeaseAuthority(planner.authority);
    const authorizedAuthority = new RuntimeAuthorizedGitOperationAuthority(planner.authority, boundaryPermitAuthority, executionPermitAuthority, participantLeaseAuthority);
    const contextFactory = new RuntimeRepositoryContextFactory(runner, authorizedAuthority, (repoId) => new StageTwoUnavailableSafetyFacade(repoId));
    const registry = new RuntimeRepositoryRegistry(contextFactory);
    const loaded = await plugin.loadData();
    const identityStore = new PersistentRepositoryIdentityStore(loaded ?? void 0, async (data) => plugin.saveData(data));
    const discovery = new DesktopRepositoryDiscovery({
      vaultRoot: adapter.getBasePath(),
      configDir: plugin.app.vault.configDir,
      identityStore,
      registry,
      relationGraph,
      planner,
      planVerifier: planner.authority,
      runner
    });
    const report = await discovery.discover(new AbortController().signal);
    const boundaryPolicy = new ReadOnlyRepositoryBoundaryPolicy(planner.authority, boundaryPermitAuthority);
    const executionPolicy = new ReadOnlyGitExecutionPolicy(planner.authority, (repoId) => registry.getRequired(repoId).metadata.trust, executionPermitAuthority);
    const queueCoordinator = new RuntimeCrossContextOperationCoordinator((repoId) => registry.getRequired(repoId).queue, participantLeaseAuthority);
    const executionCoordinator = new RuntimeGitOperationExecutionCoordinator(boundaryPolicy, executionPolicy, queueCoordinator, authorizedAuthority);
    const controller = new RuntimeRepositoryController(registry, planner, executionCoordinator);
    const accepted = report.entries.filter((entry) => entry.result === "accepted").length;
    const rejected = report.entries.length - accepted;
    new import_obsidian2.Notice(`Git ${gitVersion}: ${accepted} repositories discovered${rejected === 0 ? "" : `, ${rejected} rejected`}`);
    return new _PluginRuntime(plugin, registry, controller, gitVersion);
  }
  showRepositories() {
    new RepositoryDiagnosticsModal(this.plugin.app, this.controller).open();
  }
  async dispose() {
    const ids = this.registry.records().flatMap((record) => record.lifecycle === "ready" || record.lifecycle === "missing" ? [record.context.id] : []);
    await Promise.all(ids.map((repoId) => this.registry.dispose(repoId)));
  }
};

// src/main.ts
var GitPlugin = class extends import_obsidian3.Plugin {
  #runtime = null;
  async onload() {
    this.#runtime = await PluginRuntime.create(this);
    this.addCommand({ id: "show-repositories", name: "Git: Show repositories", callback: () => this.#runtime?.showRepositories() });
  }
  onunload() {
    const runtime = this.#runtime;
    this.#runtime = null;
    if (runtime !== null) void runtime.dispose();
  }
};
