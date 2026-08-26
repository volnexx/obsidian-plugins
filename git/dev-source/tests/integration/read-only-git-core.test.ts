import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { RuntimeAuthorizedGitOperationAuthority, RuntimeGitExecutionPermitAuthority, RuntimeParticipantQueueLeaseAuthority, RuntimeRepositoryBoundaryPermitAuthority } from "../../src/authorization/OperationAuthorization";
import { ReadOnlyRepositoryBoundaryPolicy } from "../../src/core/ReadOnlyRepositoryBoundaryPolicy";
import { RuntimeRepositoryContextFactory } from "../../src/core/RepositoryContextFactory";
import type { RepositoryDiscoveryReport } from "../../src/core/RepositoryDiscovery";
import { RuntimeRepositoryRegistry } from "../../src/core/RepositoryRegistry";
import { RuntimeRepositoryRelationGraph } from "../../src/core/RepositoryRelationGraph";
import type { OperationIntent } from "../../src/domain/OperationTypes";
import type { OperationId, RepositoryId } from "../../src/domain/RepositoryId";
import type { RepositoryDescriptor } from "../../src/domain/RepositoryDescriptor";
import type { RepositoryProbeResult } from "../../src/domain/RepositoryProbe";
import { DesktopRepositoryDiscovery } from "../../src/git/infrastructure/DesktopRepositoryDiscovery";
import { DesktopRepositoryProbeBackend } from "../../src/git/infrastructure/DesktopRepositoryProbeBackend";
import { GitCapabilityService } from "../../src/git/infrastructure/GitCapabilityService";
import { DesktopGitCommandRunner, type GitInvocationRecord } from "../../src/git/infrastructure/GitCommandRunner";
import { ReadOnlyGitExecutionPolicy } from "../../src/git/infrastructure/ReadOnlyGitExecutionPolicy";
import { PersistentRepositoryIdentityStore } from "../../src/git/infrastructure/RepositoryIdentityStore";
import { canonicalizeExistingPath } from "../../src/git/infrastructure/CanonicalPath";
import { RuntimeCrossContextOperationCoordinator, RuntimeGitOperationExecutionCoordinator } from "../../src/operations/CrossContextOperationCoordinator";
import { RuntimeOperationPlanner } from "../../src/operations/RuntimeOperationPlanner";
import { StageTwoUnavailableSafetyFacade } from "../../src/safety/StageTwoUnavailableSafetyFacade";
import { RuntimeRepositoryController } from "../../src/application/internal/RuntimeRepositoryController";

const temporaryRoots: string[] = [];
const temporaryRoot = (): string => { const root = mkdtempSync(join(tmpdir(), "obsidian-git-stage2-")); temporaryRoots.push(root); return root; };
afterEach(() => { for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const git = (cwd: string, args: readonly string[], allowFailure = false): string => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "pipe", allowFailure ? "pipe" : "inherit"] }).trim();
  } catch (error) {
    if (allowFailure) return error instanceof Error ? error.message : String(error);
    throw error;
  }
};
const write = (path: string, content: string): void => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
const initRepo = (path: string, file = "tracked.txt"): void => {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "-b", "main"]);
  write(join(path, file), "initial\n");
  git(path, ["add", "--", file]);
  git(path, ["-c", "user.name=Stage Two", "-c", "user.email=stage2@example.invalid", "commit", "-m", "initial"]);
};
const commitAll = (path: string, message: string): void => {
  git(path, ["add", "-A"]);
  git(path, ["-c", "user.name=Stage Two", "-c", "user.email=stage2@example.invalid", "commit", "-m", message]);
};

interface Harness {
  readonly registry: RuntimeRepositoryRegistry;
  readonly graph: RuntimeRepositoryRelationGraph;
  readonly planner: RuntimeOperationPlanner;
  readonly execution: RuntimeGitOperationExecutionCoordinator;
  readonly controller: RuntimeRepositoryController;
  readonly runner: DesktopGitCommandRunner;
  readonly invocations: GitInvocationRecord[];
  readonly report: RepositoryDiscoveryReport;
}

const createHarness = async (vaultRoot: string, configDir = ".custom-config", runnerOptions: ConstructorParameters<typeof DesktopGitCommandRunner>[0] = {}): Promise<Harness> => {
  const invocations: GitInvocationRecord[] = [];
  const runner = new DesktopGitCommandRunner({ ...runnerOptions, onInvocation: (record) => { invocations.push(record); runnerOptions.onInvocation?.(record); } });
  const graph = new RuntimeRepositoryRelationGraph();
  const planner = new RuntimeOperationPlanner({ family: (repoId) => {
    const family = graph.family(repoId);
    return family === null ? null : { familyId: family.id, memberCount: family.members.length };
  } });
  const boundaryAuthority = new RuntimeRepositoryBoundaryPermitAuthority();
  const executionAuthority = new RuntimeGitExecutionPermitAuthority();
  const leaseAuthority = new RuntimeParticipantQueueLeaseAuthority(planner.authority);
  const authorizedAuthority = new RuntimeAuthorizedGitOperationAuthority(planner.authority, boundaryAuthority, executionAuthority, leaseAuthority);
  const factory = new RuntimeRepositoryContextFactory(runner, authorizedAuthority, <Id extends RepositoryId>(repoId: Id) => new StageTwoUnavailableSafetyFacade(repoId));
  const registry = new RuntimeRepositoryRegistry(factory);
  const identities = new PersistentRepositoryIdentityStore(undefined, async () => Promise.resolve());
  const discovery = new DesktopRepositoryDiscovery({ vaultRoot, configDir, identityStore: identities, registry, relationGraph: graph, planner, planVerifier: planner.authority, runner });
  const report = await discovery.discover(new AbortController().signal);
  const boundary = new ReadOnlyRepositoryBoundaryPolicy(planner.authority, boundaryAuthority);
  const executionPolicy = new ReadOnlyGitExecutionPolicy(planner.authority, () => "untrusted", executionAuthority);
  const queues = new RuntimeCrossContextOperationCoordinator((repoId) => registry.getRequired(repoId).queue, leaseAuthority);
  const execution = new RuntimeGitOperationExecutionCoordinator(boundary, executionPolicy, queues, authorizedAuthority);
  const controller = new RuntimeRepositoryController(registry, planner, execution);
  return { registry, graph, planner, execution, controller, runner, invocations, report };
};

const makePluginRoot = (root: string, configDir = ".custom-config"): string => { const value = join(root, configDir, "plugins"); mkdirSync(value, { recursive: true }); return value; };
const intent = (repoId: RepositoryId): OperationIntent<RepositoryId, "status"> => ({ repoId, operationId: randomUUID() as OperationId, kind: "status", payload: {}, origin: "system", signal: new AbortController().signal, deadlineAt: Date.now() + 10_000 });

const worktreeDigest = (root: string): string => {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      hash.update(path.slice(root.length));
      if (entry.isDirectory()) visit(path); else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest("hex");
};
const sentinel = (root: string): Readonly<Record<string, string>> => {
  const gitDir = git(root, ["rev-parse", "--absolute-git-dir"]);
  return Object.freeze({
    head: git(root, ["rev-parse", "HEAD"]),
    status: execFileSync("git", ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).toString("base64"),
    index: readFileSync(join(gitDir, "index")).toString("base64"),
    config: readFileSync(join(gitDir, "config")).toString("base64"),
    worktree: worktreeDigest(root)
  });
};

const descriptorFromProbe = (result: RepositoryProbeResult): RepositoryDescriptor => Object.freeze({
  repositoryId: result.repoId, familyId: result.familyId, name: result.target.displayPath, locator: result.target.locator,
  runtimeRoot: result.runtimeRoot, displayPath: result.target.displayPath, gitDir: result.gitDir, commonDir: result.commonDir,
  superprojectRoot: result.superprojectRoot, objectFormat: result.objectFormat, aliases: Object.freeze([])
});

beforeAll(async () => { expect(await new GitCapabilityService(new DesktopGitCommandRunner()).check()).toMatch(/^git version /u); });

describe("stage-2 real system Git core", () => {
  it("discovers one and multiple independent plugin repositories using the actual configDir", async () => {
    const root = temporaryRoot();
    const plugins = makePluginRoot(root);
    initRepo(join(plugins, "parsing"));
    initRepo(join(plugins, "search"));
    mkdirSync(join(plugins, "not-a-repository"));
    const harness = await createHarness(root);
    expect(harness.report.entries.map((entry) => [entry.displayPath, entry.result])).toEqual([
      [".custom-config/plugins/not-a-repository", "rejected"],
      [".custom-config/plugins/parsing", "accepted"],
      [".custom-config/plugins/search", "accepted"]
    ]);
    expect(harness.registry.list()).toHaveLength(2);
    expect(harness.registry.list()[0]?.backend).not.toBe(harness.registry.list()[1]?.backend);
    expect(harness.registry.list()[0]?.store).not.toBe(harness.registry.list()[1]?.store);
    expect(harness.registry.list()[0]?.queue).not.toBe(harness.registry.list()[1]?.queue);
  });

  it("rejects an ancestor vault repository as the plugin candidate root but accepts a real nested plugin repository", async () => {
    const root = temporaryRoot();
    initRepo(root, "vault.txt");
    const plugins = makePluginRoot(root);
    mkdirSync(join(plugins, "ancestor-only"));
    initRepo(join(plugins, "nested-plugin"));
    const harness = await createHarness(root);
    expect(harness.report.entries.find((entry) => entry.displayPath.endsWith("ancestor-only"))?.errorCode).toBe("candidate-root-mismatch");
    expect(harness.report.entries.find((entry) => entry.displayPath.endsWith("nested-plugin"))?.result).toBe("accepted");
  });

  it("parses staged+unstaged, untracked, rename, delete, spaces, Unicode and conflict index states", async () => {
    const root = temporaryRoot();
    const repository = join(makePluginRoot(root), "status-fixture");
    initRepo(repository);
    write(join(repository, "both.txt"), "base\n");
    write(join(repository, "rename me.txt"), "rename\n");
    write(join(repository, "delete-me.txt"), "delete\n");
    commitAll(repository, "fixtures");

    git(repository, ["switch", "-c", "conflict-side"]);
    write(join(repository, "tracked.txt"), "side\n"); commitAll(repository, "side");
    git(repository, ["switch", "main"]);
    write(join(repository, "tracked.txt"), "main\n"); commitAll(repository, "main");
    git(repository, ["-c", "user.name=Stage Two", "-c", "user.email=stage2@example.invalid", "merge", "conflict-side"], true);

    write(join(repository, "both.txt"), "staged\n");
    git(repository, ["add", "--", "both.txt"]);
    write(join(repository, "both.txt"), "staged\nunstaged\n");
    git(repository, ["mv", "rename me.txt", "renamed ü.txt"]);
    unlinkSync(join(repository, "delete-me.txt"));
    write(join(repository, "untracked space λ.txt"), "new\n");

    const harness = await createHarness(root);
    const context = harness.registry.list()[0];
    expect(context).toBeDefined();
    await harness.controller.refresh({ repoId: context!.id });
    const files = context!.store.snapshot?.observation.files ?? [];
    expect(files.find((file) => file.path === "both.txt")).toMatchObject({ indexStatus: "modified", worktreeStatus: "modified" });
    expect(files.find((file) => file.path === "renamed ü.txt")).toMatchObject({ originalPath: "rename me.txt", changeKind: "rename" });
    expect(files.find((file) => file.path === "delete-me.txt")?.worktreeStatus).toBe("deleted");
    expect(files.find((file) => file.path === "untracked space λ.txt")?.untracked).toBe(true);
    expect(files.find((file) => file.path === "tracked.txt")?.changeKind).toBe("unmerged");
  });

  it("reports detached HEAD and diverged upstream ahead/behind without assuming remote names", async () => {
    const root = temporaryRoot();
    const plugins = makePluginRoot(root);
    const bare = join(root, "remote.git"); mkdirSync(bare); git(bare, ["init", "--bare"]);
    const repository = join(plugins, "tracking"); initRepo(repository);
    git(repository, ["remote", "add", "company", bare]);
    git(repository, ["push", "-u", "company", "main"]);
    write(join(repository, "local.txt"), "local\n"); commitAll(repository, "local ahead");
    const other = join(root, "other"); git(root, ["clone", bare, other]);
    git(other, ["switch", "main"]);
    write(join(other, "remote.txt"), "remote\n"); commitAll(other, "remote ahead"); git(other, ["push", "company", "main"], true); git(other, ["push", "origin", "main"]);
    git(repository, ["fetch", "company"]);
    const harness = await createHarness(root);
    const context = harness.registry.list()[0]!;
    await harness.controller.refresh({ repoId: context.id });
    expect(context.store.snapshot?.observation.branch).toMatchObject({ head: "main", upstream: "company/main", ahead: 1, behind: 1 });
    git(repository, ["checkout", "--detach", "HEAD"]);
    await harness.controller.refresh({ repoId: context.id });
    expect(context.store.snapshot?.observation.branch).toMatchObject({ head: null, detached: true });
  });

  it("models .git gitfile submodules and ordinary nested repositories", async () => {
    const root = temporaryRoot();
    initRepo(root, "super.txt");
    const source = join(temporaryRoot(), "source"); initRepo(source);
    const plugins = makePluginRoot(root);
    git(root, ["-c", "protocol.file.allow=always", "submodule", "add", source, join(plugins, "submodule")]);
    commitAll(root, "add submodule");
    const harness = await createHarness(root);
    const submodule = harness.registry.list()[0]!;
    expect(readFileSync(join(submodule.descriptor.runtimeRoot, ".git"), "utf8")).toMatch(/^gitdir:/u);
    expect(submodule.descriptor.superprojectRoot).toBe(await canonicalizeExistingPath(root));

    const graph = new RuntimeRepositoryRelationGraph();
    const planner = new RuntimeOperationPlanner({ family: () => null });
    const runner = new DesktopGitCommandRunner();
    const probe = async (candidate: string, id: RepositoryId): Promise<RepositoryProbeResult> => {
      const target = Object.freeze({ repoId: id, locator: Object.freeze({ kind: "external" as const, locatorId: id, lastKnownAbsolutePath: candidate }), candidateRoot: await canonicalizeExistingPath(candidate), displayPath: candidate });
      const backend = new DesktopRepositoryProbeBackend(target, runner, planner.authority);
      return backend.probe(await planner.plan({ repoId: id, operationId: randomUUID() as OperationId, kind: "probe", payload: {}, origin: "system", signal: new AbortController().signal, deadlineAt: Date.now() + 10_000 }));
    };
    const superResult = await probe(root, "super" as RepositoryId);
    const submoduleResult = await probe(submodule.descriptor.runtimeRoot, "submodule" as RepositoryId);
    graph.replace([descriptorFromProbe(superResult), descriptorFromProbe(submoduleResult)]);
    expect(graph.relation(submoduleResult.repoId, superResult.repoId)).toMatchObject({ kind: "submodule-of", child: submoduleResult.repoId, superproject: superResult.repoId });

    const parent = join(temporaryRoot(), "parent"); initRepo(parent);
    const nested = join(parent, "nested"); initRepo(nested);
    const parentResult = await probe(parent, "parent" as RepositoryId);
    const nestedResult = await probe(nested, "nested" as RepositoryId);
    graph.replace([descriptorFromProbe(parentResult), descriptorFromProbe(nestedResult)]);
    expect(graph.relation(parentResult.repoId, nestedResult.repoId)).toMatchObject({ kind: "nested", parent: parentResult.repoId, child: nestedResult.repoId });
  });

  it("discovers linked worktrees as one family and serializes their shared-family plans", async () => {
    const root = temporaryRoot();
    const plugins = makePluginRoot(root);
    const primary = join(plugins, "primary"); initRepo(primary);
    const linked = join(plugins, "linked"); git(primary, ["worktree", "add", "-b", "linked", linked]);
    const harness = await createHarness(root);
    const [left, right] = harness.registry.list();
    expect(left).toBeDefined(); expect(right).toBeDefined();
    expect(left!.descriptor.commonDir).toBe(right!.descriptor.commonDir);
    expect(harness.graph.relation(left!.id, right!.id).kind).toBe("shared-common-dir");
    const leftPlan = await harness.planner.plan(intent(left!.id));
    const rightPlan = await harness.planner.plan(intent(right!.id));
    expect(leftPlan.requiredLocks.familyIds).toEqual([left!.descriptor.familyId]);
    let active = 0; let maximum = 0;
    const execute = async (plan: typeof leftPlan): Promise<void> => harness.execution.execute(plan, async () => {
      active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 25)); active -= 1;
    });
    await Promise.all([execute(leftPlan), execute(rightPlan)]);
    expect(maximum).toBe(1);
  });

  it("serializes same-repository reads while allowing disjoint repositories in parallel", async () => {
    const root = temporaryRoot(); const plugins = makePluginRoot(root);
    initRepo(join(plugins, "a")); initRepo(join(plugins, "b"));
    const harness = await createHarness(root); const [a, b] = harness.registry.list();
    const measure = async (plans: readonly Awaited<ReturnType<RuntimeOperationPlanner["plan"]>>[]): Promise<number> => {
      let active = 0; let maximum = 0;
      await Promise.all(plans.map(async (plan) => harness.execution.execute(plan, async () => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 25)); active -= 1; })));
      return maximum;
    };
    expect(await measure([await harness.planner.plan(intent(a!.id)), await harness.planner.plan(intent(a!.id))])).toBe(1);
    expect(await measure([await harness.planner.plan(intent(a!.id)), await harness.planner.plan(intent(b!.id))])).toBe(2);
  });

  it("leaves disjoint Repo B unchanged and never runs Repo A with Repo B cwd", async () => {
    const root = temporaryRoot(); const plugins = makePluginRoot(root);
    const rootA = join(plugins, "a"); const rootB = join(plugins, "b"); initRepo(rootA); initRepo(rootB);
    write(join(rootA, "dirty-a.txt"), "A\n"); write(join(rootB, "sentinel-b.txt"), "B\n");
    const harness = await createHarness(root); const contextA = harness.registry.list().find((context) => context.descriptor.runtimeRoot.endsWith("/a"))!;
    const before = sentinel(rootB); harness.invocations.splice(0);
    await harness.controller.refresh({ repoId: contextA.id });
    expect(sentinel(rootB)).toEqual(before);
    expect(harness.invocations).toHaveLength(2);
    expect(harness.invocations.every((record) => record.repositoryId === contextA.id && record.cwd === contextA.descriptor.runtimeRoot)).toBe(true);
    const canonicalRootB = await canonicalizeExistingPath(rootB);
    expect(harness.invocations.every((record) => record.cwd !== canonicalRootB)).toBe(true);
  });

  it("neutralizes repository-defined clean filters for automatically discovered untrusted repositories", async () => {
    const root = temporaryRoot(); const repository = join(makePluginRoot(root), "untrusted-filter"); initRepo(repository, "payload.danger");
    write(join(repository, ".gitattributes"), "*.danger filter=evil\n"); commitAll(repository, "attributes");
    const marker = join(root, "filter-executed");
    git(repository, ["config", "filter.evil.clean", `sh -c 'echo executed > ${marker}; cat'`]);
    write(join(repository, "payload.danger"), "modified\n");
    const harness = await createHarness(root); const context = harness.registry.list()[0]!;
    await harness.controller.refresh({ repoId: context.id });
    expect(existsSync(marker)).toBe(false);
    expect(context.store.snapshot?.observation.files.find((file) => file.path === "payload.danger")?.worktreeStatus).toBe("modified");
  });

  it("fails closed for missing repositories, cancellation and elapsed deadlines", async () => {
    const root = temporaryRoot(); const repository = join(makePluginRoot(root), "missing"); initRepo(repository);
    const harness = await createHarness(root); const context = harness.registry.list()[0]!;
    const cancelled = new AbortController(); cancelled.abort();
    await expect(harness.runner.runStatus(context.descriptor, randomUUID() as OperationId, cancelled.signal, Date.now() + 1_000)).rejects.toMatchObject({ code: "cancelled" });
    await expect(harness.runner.runStatus(context.descriptor, randomUUID() as OperationId, new AbortController().signal, Date.now() - 1)).rejects.toMatchObject({ code: "timeout" });
    renameSync(repository, `${repository}-moved`);
    await expect(harness.controller.refresh({ repoId: context.id })).rejects.toMatchObject({ code: "repository-missing" });
    expect(context.store.lifecycle).toBe("missing");
  });
});
