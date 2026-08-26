import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { STAGE_TWO_REPOSITORY_COMMANDS } from "../../src/git/infrastructure/GitCommandRunner";

const projectRoot = resolve(import.meta.dirname, "../..");

const parse = (relativePath: string): ts.SourceFile => {
  const path = resolve(projectRoot, relativePath);
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
};

const interfaceProperties = (source: ts.SourceFile, interfaceName: string): readonly string[] => {
  const declaration = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  );

  if (declaration === undefined) {
    return [];
  }

  return declaration.members.flatMap((member) => {
    if ((ts.isPropertySignature(member) || ts.isMethodSignature(member)) && ts.isIdentifier(member.name)) {
      return [member.name.text];
    }
    return [];
  });
};

const classProperties = (source: ts.SourceFile, className: string): readonly string[] => {
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className
  );
  if (declaration === undefined) return [];
  return declaration.members.flatMap((member) => {
    if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) return [member.name.text];
    if (ts.isConstructorDeclaration(member)) {
      return member.parameters.flatMap((parameter) =>
        parameter.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) === true && ts.isIdentifier(parameter.name)
          ? [parameter.name.text]
          : []
      );
    }
    return [];
  });
};

describe("normative architecture contracts", () => {
  it("requires repoId and typed payload on intent while reserving effects for validated plans", () => {
    const source = parse("src/domain/OperationTypes.ts");
    expect(interfaceProperties(source, "OperationIntent")).toEqual(
      expect.arrayContaining(["repoId", "operationId", "kind", "payload"])
    );
    expect(interfaceProperties(source, "OperationIntent")).not.toEqual(expect.arrayContaining(["effects", "impact"]));
    const planSource = parse("src/domain/ValidatedOperationPlan.ts");
    expect(classProperties(planSource, "ValidatedOperationPlan")).toEqual(
      expect.arrayContaining(["repoId", "operationId", "kind", "payload", "effects", "scope", "requiredLocks", "planIdentity", "planDigest", "payloadDigest"])
    );
    expect(interfaceProperties(source, "OperationEffects")).toEqual([
      "network",
      "mutatesWorktree",
      "mutatesIndex",
      "mutatesGitConfig",
      "mutatesGitMetadata",
      "mutatesLocalRefs",
      "mutatesRemoteRefs",
      "destructive"
    ]);
    expect(interfaceProperties(source, "OperationImpactPlan")).toEqual([
      "repoId",
      "worktree",
      "index",
      "gitConfig",
      "gitMetadata",
      "localRefs",
      "remoteRefs"
    ]);
  });

  it("centralizes planning and fails closed on an effects mismatch", () => {
    expect(interfaceProperties(parse("src/operations/OperationPlanner.ts"), "OperationPlanner")).toEqual(["plan"]);
    const source = parse("src/domain/OperationTypes.ts").getFullText();
    expect(source).toContain("assertTrustedEffects");
    expect(source).toContain("Operation effects mismatch");
    const planSource = parse("src/domain/ValidatedOperationPlan.ts").getFullText();
    expect(planSource).toContain("WeakMap");
    expect(planSource).toContain("RuntimeValidatedOperationPlanAuthority");
    expect(planSource).toContain("instanceof ValidatedOperationPlan");
    expect(planSource).toContain("verifyPlanDigestAndRequiredLocks");
  });

  it("does not expose backend retargeting fields or flags", () => {
    const source = parse("src/git/GitBackend.ts");
    const text = source.getFullText();
    const forbiddenPropertyNames = new Set(["cwd", "gitDir", "workTree", "worktree", "basePath", "repoPath"]);
    const violations: string[] = [];

    const visit = (node: ts.Node): void => {
      if (
        (ts.isPropertySignature(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        forbiddenPropertyNames.has(node.name.text)
      ) {
        violations.push(node.name.text);
      }
      ts.forEachChild(node, visit);
    };

    visit(source);

    expect(violations).toEqual([]);
    expect(text).not.toContain('"-C"');
    expect(text).not.toContain('"--git-dir"');
    expect(text).not.toContain('"--work-tree"');
  });

  it("keeps RepoStore canonical and projection-free", () => {
    const source = parse("src/state/RepoStore.ts");
    const observationSource = parse("src/domain/RepositorySnapshot.ts");
    const observationProperties = interfaceProperties(observationSource, "RepositoryObservation");
    const snapshotProperties = interfaceProperties(source, "StoredRepositorySnapshot");
    const storeProperties = interfaceProperties(source, "RepoStore");

    expect(observationProperties).toContain("files");
    expect(observationProperties).not.toEqual(expect.arrayContaining(["generation", "confidence", "lifecycle"]));
    expect(snapshotProperties).toEqual(expect.arrayContaining(["observation", "generation", "confidence", "appliedAt"]));
    expect(storeProperties).not.toEqual(
      expect.arrayContaining(["staged", "unstaged", "deleted", "renamed", "untracked", "conflicted"])
    );
  });

  it("keeps GitBackend independent from state and RepoStore", () => {
    const source = parse("src/git/GitBackend.ts");
    const imports = source.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        return [];
      }
      return [statement.moduleSpecifier.text];
    });

    expect(imports.some((moduleName) => moduleName.includes("state") || moduleName.includes("RepoStore"))).toBe(
      false
    );
  });

  it("separates provisional probe target from resolved descriptor", () => {
    const probeSource = parse("src/domain/RepositoryProbe.ts");
    const targetProperties = interfaceProperties(probeSource, "RepositoryProbeTarget");
    const resultProperties = interfaceProperties(probeSource, "RepositoryProbeResult");
    const descriptorProperties = interfaceProperties(parse("src/domain/RepositoryDescriptor.ts"), "RepositoryDescriptor");
    const provisionalProperties = interfaceProperties(
      parse("src/core/ProvisionalRepositoryContext.ts"),
      "ProvisionalRepositoryContext"
    );
    const factoryProperties = interfaceProperties(
      parse("src/core/RepositoryContextFactory.ts"),
      "RepositoryContextFactory"
    );

    expect(targetProperties).toEqual(expect.arrayContaining(["repoId", "locator", "candidateRoot"]));
    expect(targetProperties).not.toEqual(expect.arrayContaining(["gitDir", "commonDir"]));
    expect(resultProperties).toEqual(
      expect.arrayContaining(["repoId", "target", "runtimeRoot", "gitDir", "commonDir", "familyId"])
    );
    expect(descriptorProperties).toEqual(
      expect.arrayContaining(["runtimeRoot", "gitDir", "commonDir", "familyId"])
    );
    expect(provisionalProperties).toEqual(["id", "lifecycle", "target", "probeBackend"]);
    expect(provisionalProperties).not.toEqual(expect.arrayContaining(["descriptor", "backend", "store"]));
    expect(factoryProperties).toEqual(["finalize"]);
  });

  it("models linked worktrees as a shared common-dir relation", () => {
    const relationSource = parse("src/domain/RepositoryRelation.ts");
    expect(interfaceProperties(relationSource, "SharedCommonDirRepositoryRelation")).toEqual(
      expect.arrayContaining(["left", "right", "familyId", "commonDir"])
    );
    expect(interfaceProperties(relationSource, "RepositoryFamily")).toEqual(
      expect.arrayContaining(["id", "commonDir", "members"])
    );
    expect(interfaceProperties(parse("src/core/RepositoryRelationGraph.ts"), "RepositoryRelationGraph")).toEqual(
      expect.arrayContaining(["family", "areByteIsolated"])
    );
  });

  it("separates pull-rebase and amend from ordinary non-destructive backend operations", () => {
    const requestSource = parse("src/domain/OperationRequests.ts");
    const effectsSource = parse("src/domain/OperationTypes.ts").getFullText();
    const safetySource = parse("src/safety/RepositorySafetyFacade.ts");

    expect(interfaceProperties(requestSource, "CommitRequest")).toEqual(["message"]);
    expect(interfaceProperties(safetySource, "RepositorySafetyFacade")).toContain("amendCommit");
    expect(interfaceProperties(safetySource, "RepositorySafetyFacade")).toContain("pullRebase");
    expect(effectsSource).toContain('"pull-rebase"');
    expect(effectsSource).not.toContain("readonly pull:");
  });

  it("requires an opaque permit for the internal destructive executor", () => {
    const source = parse("src/safety/internal/VerifiedDestructiveExecutor.ts");
    expect(classProperties(source, "VerifiedDestructivePermit")).toEqual(
      expect.arrayContaining(["repoId", "operationId", "kind", "planIdentity", "planDigest", "payloadDigest", "backupId"])
    );
    expect(classProperties(source, "VerifiedDestructivePermit")).not.toContain("impact");
    expect(interfaceProperties(source, "VerifiedDestructiveExecutor")).toEqual(["execute"]);
    expect(source.getFullText()).toContain("AuthorizedGitOperation");
  });

  it("binds boundary and backup authorization to the complete validated plan identity", () => {
    const boundary = parse("src/core/RepositoryBoundaryPolicy.ts");
    const authorization = parse("src/authorization/OperationAuthorization.ts");
    const backup = parse("src/safety/SafetyBackupService.ts");
    expect(classProperties(authorization, "RepositoryBoundaryPermit")).toEqual(
      expect.arrayContaining(["planIdentity", "planDigest", "participantRepoIds"])
    );
    expect(interfaceProperties(boundary, "RepositoryBoundaryPolicy")).toEqual(["authorize"]);
    expect(interfaceProperties(backup, "SafetyBackupRequest")).toEqual(["plan"]);
    expect(classProperties(backup, "VerifiedSafetyBackup")).toEqual(
      expect.arrayContaining(["planIdentity", "planDigest", "payloadDigest"])
    );
  });

  it("requires a plan-bound active multi-queue lease before backend authorization", () => {
    const authorization = parse("src/authorization/OperationAuthorization.ts");
    const validatedPlan = parse("src/domain/ValidatedOperationPlan.ts");
    const coordinator = parse("src/operations/CrossContextOperationCoordinator.ts");
    expect(classProperties(authorization, "ParticipantQueueLease")).toEqual(
      expect.arrayContaining(["planIdentity", "planDigest", "participantRepoIds", "repositoryFamilyIds", "acquisitionOrder"])
    );
    expect(classProperties(authorization, "AuthorizedGitOperation")).toEqual(
      expect.arrayContaining(["plan", "boundaryPermit", "executionPermit", "queueLease"])
    );
    expect(interfaceProperties(coordinator, "CrossContextOperationCoordinator")).toEqual(["withParticipantQueues"]);
    expect(interfaceProperties(coordinator, "GitOperationExecutionCoordinator")).toEqual(["execute"]);
    expect(coordinator.getFullText()).toContain("release every acquired lease in finally");
    expect(coordinator.getFullText()).toContain("sorted RepositoryId/family keys");
    expect(validatedPlan.getFullText()).toContain("sort((left, right) => left.localeCompare(right))");
    expect(validatedPlan.getFullText()).toContain("requiredLocks");
    expect(authorization.getFullText()).not.toContain("repositoryFamilyIds: readonly RepositoryFamilyId[], acquiredAt");
    expect(authorization.getFullText()).toContain("verifyActive");
    expect(authorization.getFullText()).toContain("overlaps an active operation");
    expect(authorization.getFullText()).toContain("plan.requiredLocks.repositoryIds");
    expect(authorization.getFullText()).toContain("plan.requiredLocks.familyIds");
    expect(authorization.getFullText()).toContain("candidate.repositoryFamilyIds.length === plan.requiredLocks.familyIds.length");
  });

  it("binds authorized verification to the concrete backend repository and method kind", () => {
    const authorization = parse("src/authorization/OperationAuthorization.ts");
    expect(interfaceProperties(authorization, "AuthorizedGitOperationVerifier")).toEqual(["verifyFor"]);
    const text = authorization.getFullText();
    expect(text).toContain("candidate.plan.repoId === expectedRepoId");
    expect(text).toContain("candidate.plan.kind === expectedKind");
  });

  it("defensively snapshots nested security-relevant authorization data", () => {
    const plan = parse("src/domain/ValidatedOperationPlan.ts").getFullText();
    const authorization = parse("src/authorization/OperationAuthorization.ts").getFullText();
    expect(plan).toContain("structuredClone(value)");
    expect(plan).toContain("requiredLocks: immutableSnapshot(data.requiredLocks)");
    expect(plan).toContain("scope: immutableSnapshot(data.scope)");
    expect(authorization).toContain("disabledSurfaces: Object.freeze([...profile.disabledSurfaces])");
    expect(authorization).toContain("Object.freeze([...plan.requiredLocks.familyIds])");
  });

  it("uses runtime authorities instead of compile-time-only branded capability objects", () => {
    const plan = parse("src/domain/ValidatedOperationPlan.ts").getFullText();
    const authorization = parse("src/authorization/OperationAuthorization.ts").getFullText();
    expect(plan).toContain("planIssuers = new WeakMap");
    expect(authorization).toContain("boundaryIssuers = new WeakMap");
    expect(authorization).toContain("executionIssuers = new WeakMap");
    expect(authorization).toContain("queueLeaseIssuers = new WeakMap");
    expect(authorization).toContain("authorizedIssuers = new WeakMap");
    expect(authorization).toContain("Authorization evidence does not match the validated plan");
    expect(plan).not.toMatch(/\bas\s+(?:any|unknown|ValidatedOperationPlan)/u);
    expect(authorization).not.toMatch(/\bas\s+(?:any|unknown|AuthorizedGitOperation|RepositoryBoundaryPermit|GitExecutionPermit|ParticipantQueueLease)/u);
    expect(plan).not.toContain("export const planConstructionToken");
    expect(authorization).not.toContain("export const authorizedToken");
  });

  it("models remote-ref ownership, including registered local-path remotes", () => {
    const source = parse("src/domain/OperationTypes.ts");
    expect(interfaceProperties(source, "RemoteRefTargetImpact")).toEqual(["target", "refs"]);
    expect(interfaceProperties(source, "RemoteRefImpactPlan")).toEqual(["scope", "targets"]);
    expect(source.getFullText()).toContain("targetRepoId");
    expect(source.getFullText()).toContain("canonicalTargetRoot");
  });

  it("keeps main.ts as a composition root", () => {
    const source = parse("src/main.ts");
    const imports = source.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        return [];
      }
      return [statement.moduleSpecifier.text];
    });
    const topLevelVariables = source.statements.filter(ts.isVariableStatement);
    const classes = source.statements.filter(ts.isClassDeclaration);

    expect(imports.every((moduleName) => moduleName === "obsidian" || moduleName.startsWith("./composition/"))).toBe(
      true
    );
    expect(topLevelVariables).toEqual([]);
    expect(classes).toHaveLength(1);
  });

  it("contains concrete context-bound desktop backend and restricted probe implementations", () => {
    const source = parse("src/git/infrastructure/DesktopGitBackend.ts");
    const concreteClasses = source.statements.filter(
      (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "DesktopGitBackend"
    );

    expect(concreteClasses).toHaveLength(1);
    expect(source.getFullText()).toContain("verifyFor(operation, this.repositoryId, \"status\")");

    const probeSource = parse("src/git/infrastructure/DesktopRepositoryProbeBackend.ts");
    const concreteProbeClasses = probeSource.statements.filter(
      (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "DesktopRepositoryProbeBackend"
    );
    expect(concreteProbeClasses).toHaveLength(1);
    expect(probeSource.getFullText()).toContain("candidate-root-mismatch");
  });

  it("locks production repository commands to the stage-2 read-only allowlist", () => {
    expect(STAGE_TWO_REPOSITORY_COMMANDS).toEqual({
      "probe-layout": ["rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir", "--is-inside-work-tree", "--show-superproject-working-tree"],
      "probe-object-format": ["rev-parse", "--show-object-format"],
      "execution-config": ["config", "--local", "--null", "--name-only", "--get-regexp", "^(filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver|diff\\..*\\.(command|textconv)|credential(\\..*)?\\.helper|core\\.(hooksPath|sshCommand|fsmonitor))$"],
      status: ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--ignore-submodules=dirty"]
    });
    const commandWords = Object.values(STAGE_TWO_REPOSITORY_COMMANDS).map((argv) => argv[0]);
    expect(commandWords).toEqual(["rev-parse", "rev-parse", "config", "status"]);
    for (const prohibited of ["add", "commit", "reset", "clean", "checkout", "switch", "branch", "merge", "rebase", "fetch", "pull", "push", "update-ref", "apply"]) {
      expect(commandWords).not.toContain(prohibited);
    }
    expect(STAGE_TWO_REPOSITORY_COMMANDS["execution-config"]).toEqual(expect.arrayContaining(["--local", "--name-only", "--get-regexp"]));
    expect(STAGE_TWO_REPOSITORY_COMMANDS["execution-config"]).not.toEqual(expect.arrayContaining(["--add", "--replace-all", "--unset", "--remove-section", "--rename-section"]));
    const runner = parse("src/git/infrastructure/GitCommandRunner.ts").getFullText();
    expect(runner).toContain("shell: false");
    expect(runner).toContain('GIT_TERMINAL_PROMPT = "0"');
    expect(runner).toContain('GIT_OPTIONAL_LOCKS = "0"');
    expect(runner).toContain("GIT_CONFIG_GLOBAL = devNull");
    expect(runner).toContain("keys.flatMap");
    expect(runner).toContain("assertReadOnlyArgv");
  });

  it("does not hardcode default remote or branch names in application contracts", () => {
    const sources = [parse("src/application/public/RemoteService.ts"), parse("src/git/GitBackend.ts")];
    const forbidden = new Set(["origin", "main", "master"]);
    const literals: string[] = [];

    for (const source of sources) {
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) && forbidden.has(node.text)) {
          literals.push(node.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(literals).toEqual([]);
  });

  it("pins every direct development dependency to an exact version", () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const packageLock = JSON.parse(readFileSync(resolve(projectRoot, "package-lock.json"), "utf8")) as {
      packages: { "": { devDependencies: Record<string, string> } };
    };
    const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

    expect(Object.values(packageJson.devDependencies).every((version) => exactVersion.test(version))).toBe(true);
    expect(packageLock.packages[""].devDependencies).toEqual(packageJson.devDependencies);
  });
});
