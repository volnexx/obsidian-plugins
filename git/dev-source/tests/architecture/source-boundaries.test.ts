import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const sourceRoot = resolve(projectRoot, "src");
interface ParsedSource { readonly path: string; readonly relativePath: string; readonly sourceFile: ts.SourceFile; }
const sourcePaths = (directory: string): readonly string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(directory, entry.name);
  return entry.isDirectory() ? sourcePaths(path) : extname(entry.name) === ".ts" ? [path] : [];
});
const parsed = (path: string): ParsedSource => ({ path, relativePath: relative(projectRoot, path).replaceAll("\\", "/"), sourceFile: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true) });
const sources = sourcePaths(sourceRoot).map(parsed);
const importsOf = (source: ParsedSource): readonly string[] => source.sourceFile.statements.flatMap((statement) =>
  ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : []);

const resolvedSourceImport = (source: ParsedSource, moduleName: string): string | null => {
  if (!moduleName.startsWith(".")) return null;
  const target = relative(projectRoot, resolve(dirname(source.path), moduleName)).replaceAll("\\", "/");
  return target.startsWith("src/") ? target : null;
};

const uiBoundaryViolations = (source: ParsedSource): readonly string[] => importsOf(source).flatMap((moduleName) => {
  const target = resolvedSourceImport(source, moduleName);
  if (target === null || target.startsWith("src/application/public/") || target.startsWith("src/ui/")) return [];
  return [`${source.relativePath} -> ${target}`];
});

type Layer = "domain" | "authorization" | "core" | "git" | "state" | "operations" | "safety" | "watching" | "application" | "ui";
const layerOf = (path: string): Layer | null => {
  const match = /^src\/(domain|authorization|core|git|state|operations|safety|watching|application|ui)\//.exec(path);
  return (match?.[1] as Layer | undefined) ?? null;
};
const lowerLayers = new Set<Layer>(["domain", "authorization", "core", "git", "state", "operations", "safety", "watching"]);
const layerViolations = (source: ParsedSource, assumedLayer?: Layer): readonly string[] => importsOf(source).flatMap((moduleName) => {
  const target = resolvedSourceImport(source, moduleName);
  if (target === null) return [];
  const from = assumedLayer ?? layerOf(source.relativePath);
  const to = layerOf(target);
  if (from !== null && lowerLayers.has(from) && (to === "application" || to === "ui")) return [`${from}->${to}:${source.relativePath} -> ${target}`];
  if (from === "application" && to === "ui") return [`application->ui:${source.relativePath} -> ${target}`];
  return [];
});

interface InterfaceSurface {
  readonly heritage: readonly string[];
  readonly properties: readonly { readonly name: string; readonly functionValued: boolean }[];
  readonly methods: readonly string[];
  readonly callSignatures: number;
  readonly constructSignatures: number;
  readonly indexSignatures: number;
  readonly unknownMembers: number;
}
const interfaceSurface = (source: ParsedSource, interfaceName: string): InterfaceSurface => {
  const declaration = source.sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName);
  if (declaration === undefined) throw new Error(`Missing interface ${interfaceName}`);
  const properties: { name: string; functionValued: boolean }[] = [];
  const methods: string[] = [];
  let callSignatures = 0;
  let constructSignatures = 0;
  let indexSignatures = 0;
  let unknownMembers = 0;
  for (const member of declaration.members) {
    if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
      properties.push({ name: member.name.text, functionValued: member.type !== undefined && ts.isFunctionTypeNode(member.type) });
    } else if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) methods.push(member.name.text);
    else if (ts.isCallSignatureDeclaration(member)) callSignatures += 1;
    else if (ts.isConstructSignatureDeclaration(member)) constructSignatures += 1;
    else if (ts.isIndexSignatureDeclaration(member)) indexSignatures += 1;
    else unknownMembers += 1;
  }
  return {
    heritage: declaration.heritageClauses?.flatMap((clause) => clause.types.map((type) => type.expression.getText(source.sourceFile))) ?? [],
    properties,
    methods,
    callSignatures,
    constructSignatures,
    indexSignatures,
    unknownMembers
  };
};

const interfaceFirstParameterTypes = (source: ParsedSource, interfaceName: string): readonly string[] => {
  const declaration = source.sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName);
  if (declaration === undefined) throw new Error(`Missing interface ${interfaceName}`);
  return declaration.members.flatMap((member) => ts.isMethodSignature(member) && member.parameters[0]?.type !== undefined ? [member.parameters[0].type.getText(source.sourceFile)] : []);
};

describe("source dependency boundaries", () => {
  it("permits process execution only in the reviewed Git command runner", () => {
    const forbidden = new Set(["child_process", "node:child_process", "simple-git"]);
    expect(sources.flatMap((source) => importsOf(source).filter((name) => forbidden.has(name)).map((name) => `${source.relativePath} -> ${name}`))).toEqual([
      "src/git/infrastructure/GitCommandRunner.ts -> node:child_process"
    ]);
  });

  it("allows UI imports only from application/public, UI, or external APIs", () => {
    expect(sources.filter((source) => source.relativePath.startsWith("src/ui/")).flatMap(uiBoundaryViolations)).toEqual([]);
  });

  it("detects UI bypasses through RepositoryContext and application/internal fixtures", () => {
    const direct = parsed(resolve(projectRoot, "tests/architecture/fixtures/ui/direct-backend-bypass.fixture.ts"));
    const internal = parsed(resolve(projectRoot, "tests/architecture/fixtures/ui/application-internal-bypass.fixture.ts"));
    expect(uiBoundaryViolations(direct)).toEqual([expect.stringContaining("src/core/RepositoryContext")]);
    expect(uiBoundaryViolations(internal)).toEqual([expect.stringContaining("src/application/internal/ApplicationOrchestrator")]);
  });

  it("enforces the checked reverse-dependency layer matrix", () => {
    expect(sources.flatMap((source) => layerViolations(source))).toEqual([]);
    const fixtures: readonly [string, Layer, string][] = [
      ["core-to-application.fixture.ts", "core", "core->application"],
      ["state-to-application.fixture.ts", "state", "state->application"],
      ["safety-to-ui.fixture.ts", "safety", "safety->ui"]
    ];
    for (const [name, layer, expected] of fixtures) {
      const fixture = parsed(resolve(projectRoot, `tests/architecture/fixtures/layers/${name}`));
      expect(layerViolations(fixture, layer)).toEqual([expect.stringContaining(expected)]);
    }
  });

  it("has no top-level repository singleton variables", () => {
    const forbidden = new Set(["gitManager", "basePath", "repoStore", "repositoryStore"]);
    const violations: string[] = [];
    for (const source of sources) for (const statement of source.sourceFile.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && forbidden.has(declaration.name.text)) violations.push(`${source.relativePath}:${declaration.name.text}`);
      if (declaration.type?.getText(source.sourceFile).includes("RepoStore") === true) violations.push(`${source.relativePath}:global RepoStore instance`);
    }
    expect(violations).toEqual([]);
  });

  it("locks the entire GitBackend interface surface to an exact allowlist", () => {
    const source = sources.find((item) => item.relativePath === "src/git/GitBackend.ts")!;
    expect(interfaceSurface(source, "GitBackend")).toEqual({
      heritage: [],
      properties: [{ name: "repositoryId", functionValued: false }, { name: "descriptor", functionValued: false }],
      methods: ["status"],
      callSignatures: 0, constructSignatures: 0, indexSignatures: 0, unknownMembers: 0
    });
    const parameterTypes = interfaceFirstParameterTypes(source, "GitBackend");
    expect(parameterTypes).toHaveLength(1);
    expect(parameterTypes.every((type) => type.startsWith("AuthorizedGitOperation<Id,"))).toBe(true);
    expect(source.sourceFile.getFullText()).not.toContain("ValidatedOperationPlan");
  });

  it("contains a negative application/internal bare-plan backend bypass fixture", () => {
    const path = resolve(projectRoot, "tests/types/application-internal-backend-bypass.type-test.ts");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("@ts-expect-error");
    expect(text).toContain("context.backend.status(plan)");
  });

  it("locks the entire RepositoryProbeBackend interface surface", () => {
    const source = sources.find((item) => item.relativePath === "src/git/RepositoryProbeBackend.ts")!;
    expect(interfaceSurface(source, "RepositoryProbeBackend")).toEqual({
      heritage: [], properties: [{ name: "repositoryId", functionValued: false }, { name: "target", functionValued: false }], methods: ["probe"], callSignatures: 0, constructSignatures: 0, indexSignatures: 0, unknownMembers: 0
    });
  });

  it("detects property, call/index signature and inherited surface escape hatches", () => {
    const fixture = parsed(resolve(projectRoot, "tests/architecture/fixtures/backend/full-surface-escape.fixture.ts"));
    expect(interfaceSurface(fixture, "BackendSurfaceEscape")).toMatchObject({ heritage: ["InheritedEscape"], properties: [{ name: "repositoryId", functionValued: false }, { name: "rawExecutor", functionValued: true }], callSignatures: 1, indexSignatures: 1 });
  });

  it("keeps destructive plans on the safety facade and internals private", () => {
    const backend = sources.find((item) => item.relativePath === "src/git/GitBackend.ts")!;
    const safety = sources.find((item) => item.relativePath === "src/safety/RepositorySafetyFacade.ts")!;
    expect(interfaceSurface(backend, "GitBackend").methods).not.toEqual(expect.arrayContaining(["pullRebase", "execute", "discardAll", "resetHard"]));
    expect(interfaceSurface(safety, "RepositorySafetyFacade").methods).toEqual(expect.arrayContaining(["pullRebase", "amendCommit", "discardAll", "resetHard", "forceUpdateRemoteRef"]));
    expect(sources.flatMap((source) => {
      const allowed = source.relativePath.startsWith("src/safety/");
      return allowed ? [] : importsOf(source).filter((name) => name.includes("safety/internal")).map((name) => `${source.relativePath} -> ${name}`);
    })).toEqual([]);
  });
});
