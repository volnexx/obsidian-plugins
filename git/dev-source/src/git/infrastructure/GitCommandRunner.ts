import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { devNull } from "node:os";
import type { Readable } from "node:stream";

import type { OperationId, RepositoryId } from "../../domain/RepositoryId";
import type { RepositoryDescriptor } from "../../domain/RepositoryDescriptor";
import type { RepositoryProbeTarget } from "../../domain/RepositoryProbe";
import { GitRuntimeError, type GitDiagnosticContext } from "../GitErrors";

export type RepositoryReadCommand = "probe-layout" | "probe-object-format" | "execution-config" | "status";

export interface GitCommandResult {
  readonly stdout: Uint8Array;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface GitCommandRunnerOptions {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly onInvocation?: (record: GitInvocationRecord) => void;
}

export interface GitInvocationRecord {
  readonly repositoryId: RepositoryId | "process";
  readonly operationId: OperationId | "git-capability";
  readonly cwd: string | null;
  readonly argv: readonly string[];
}

const GLOBAL_READ_ONLY_ARGUMENTS = Object.freeze([
  "--no-pager",
  "--no-optional-locks",
  "-c", "core.hooksPath=",
  "-c", "core.fsmonitor=false",
  "-c", "credential.helper=",
  "-c", "core.sshCommand=",
  "-c", "diff.external=",
  "-c", "submodule.recurse=false"
]);

export const STAGE_TWO_REPOSITORY_COMMANDS: Readonly<Record<RepositoryReadCommand, readonly string[]>> = Object.freeze({
  "probe-layout": Object.freeze(["rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir", "--is-inside-work-tree", "--show-superproject-working-tree"]),
  "probe-object-format": Object.freeze(["rev-parse", "--show-object-format"]),
  "execution-config": Object.freeze(["config", "--local", "--null", "--name-only", "--get-regexp", "^(filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver|diff\\..*\\.(command|textconv)|credential(\\..*)?\\.helper|core\\.(hooksPath|sshCommand|fsmonitor))$"]),
  status: Object.freeze(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--ignore-submodules=dirty"])
});

const FORBIDDEN_RETARGET_ARGUMENTS = ["-C", "--git-dir", "--work-tree", "--namespace", "--bare"] as const;
const isRetargetArgument = (argument: string): boolean => FORBIDDEN_RETARGET_ARGUMENTS.some((forbidden) =>
  argument === forbidden || argument.startsWith(`${forbidden}=`) || (forbidden === "-C" && argument.startsWith("-C"))
);

export const assertReadOnlyArgv = (argv: readonly string[]): void => {
  if (argv.some(isRetargetArgument)) throw new TypeError("Git repository retargeting arguments are forbidden");
  if (argv.length === 1 && argv[0] === "--version") return;
  let command: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "-c") { index += 1; continue; }
    if (value !== undefined && !value.startsWith("-")) { command = value; break; }
  }
  if (command !== "rev-parse" && command !== "status" && command !== "config") throw new TypeError("Git command is outside the stage-2 read-only allowlist");
};

const redactSecrets = (value: string): string => value
  .replace(/:\/\/([^\s/:@]+):([^\s@]+)@/gu, "://$1:[REDACTED]@")
  .replace(/\b(authorization|token|password|passwd|secret)=([^\s]+)/giu, "$1=[REDACTED]")
  .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/giu, "Bearer [REDACTED]");

const filteredEnvironment = (source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP"] as const) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  result.GIT_TERMINAL_PROMPT = "0";
  result.GIT_OPTIONAL_LOCKS = "0";
  result.GIT_PAGER = "cat";
  result.GIT_CONFIG_NOSYSTEM = "1";
  result.GIT_CONFIG_GLOBAL = devNull;
  result.LC_ALL = "C";
  return result;
};

export class DesktopGitCommandRunner {
  readonly #gitBinary: string;
  readonly #timeoutMs: number;
  readonly #maxStdoutBytes: number;
  readonly #maxStderrBytes: number;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #onInvocation: ((record: GitInvocationRecord) => void) | undefined;

  constructor(options: GitCommandRunnerOptions = {}) {
    this.#gitBinary = options.gitBinary ?? "git";
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxStdoutBytes = options.maxStdoutBytes ?? 16 * 1024 * 1024;
    this.#maxStderrBytes = options.maxStderrBytes ?? 1024 * 1024;
    this.#environment = filteredEnvironment(options.environment ?? process.env);
    this.#onInvocation = options.onInvocation;
  }

  checkCapability(signal?: AbortSignal): Promise<string> {
    return this.#execute(null, ["--version"], { repositoryId: "process", operationId: "git-capability", command: "git --version" }, signal, Date.now() + this.#timeoutMs)
      .then((result) => new TextDecoder().decode(result.stdout).trim());
  }

  runProbe<Id extends RepositoryId>(target: RepositoryProbeTarget<Id>, operationId: OperationId, command: "probe-layout" | "probe-object-format", signal: AbortSignal, deadlineAt: number): Promise<GitCommandResult> {
    return this.#runAt(target.candidateRoot, target.repoId, operationId, command, signal, deadlineAt);
  }

  async runStatus<Id extends RepositoryId>(descriptor: RepositoryDescriptor<Id>, operationId: OperationId, signal: AbortSignal, deadlineAt: number): Promise<GitCommandResult> {
    const configured = await this.#runAt(descriptor.runtimeRoot, descriptor.repositoryId, operationId, "execution-config", signal, deadlineAt, [0, 1]);
    const keys = new TextDecoder().decode(configured.stdout).split("\0").filter((value) => value.length > 0);
    if (keys.length > 1_000 || keys.some((key) => !/^[A-Za-z0-9.-]+$/u.test(key))) throw new GitRuntimeError("invalid-output", "Unsafe Git execution-surface configuration key", { repositoryId: descriptor.repositoryId, operationId, command: "execution-config" });
    const overrides = keys.flatMap((key) => ["-c", `${key}=`]);
    const argv = [...GLOBAL_READ_ONLY_ARGUMENTS, ...overrides, ...STAGE_TWO_REPOSITORY_COMMANDS.status];
    return this.#execute(descriptor.runtimeRoot, argv, { repositoryId: descriptor.repositoryId, operationId, command: "status" }, signal, deadlineAt, [0]);
  }

  #runAt(cwd: string, repositoryId: RepositoryId, operationId: OperationId, command: RepositoryReadCommand, signal: AbortSignal, deadlineAt: number, allowedExitCodes: readonly number[] = [0]): Promise<GitCommandResult> {
    const argv = [...GLOBAL_READ_ONLY_ARGUMENTS, ...STAGE_TWO_REPOSITORY_COMMANDS[command]];
    return this.#execute(cwd, argv, { repositoryId, operationId, command }, signal, deadlineAt, allowedExitCodes);
  }

  #execute(cwd: string | null, argv: readonly string[], diagnostics: GitDiagnosticContext, signal: AbortSignal | undefined, deadlineAt: number, allowedExitCodes: readonly number[] = [0]): Promise<GitCommandResult> {
    assertReadOnlyArgv(argv);
    if (cwd !== null && !existsSync(cwd)) return Promise.reject(new GitRuntimeError("repository-missing", "Repository execution root is missing", diagnostics));
    if (signal?.aborted === true) return Promise.reject(new GitRuntimeError("cancelled", "Git operation was cancelled before process start", diagnostics));
    const timeoutMs = Math.min(this.#timeoutMs, deadlineAt - Date.now());
    if (timeoutMs <= 0) return Promise.reject(new GitRuntimeError("timeout", "Git operation deadline elapsed before process start", diagnostics));
    const record: GitInvocationRecord = Object.freeze({ repositoryId: diagnostics.repositoryId, operationId: diagnostics.operationId, cwd, argv: Object.freeze([...argv]) });
    this.#onInvocation?.(record);

    return new Promise((resolve, reject) => {
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        child = spawn(this.#gitBinary, argv, { cwd: cwd ?? undefined, env: this.#environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        reject(new GitRuntimeError("git-not-found", `Unable to start system Git: ${error instanceof Error ? error.message : String(error)}`, diagnostics));
        return;
      }
      const startedAt = Date.now();
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminalError: GitRuntimeError | null = null;
      let settled = false;
      let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
      const terminate = (error: GitRuntimeError): void => {
        terminalError ??= error;
        if (!child.killed) {
          child.kill("SIGTERM");
          forceKillTimer ??= setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 250);
        }
      };
      const timer = setTimeout(() => terminate(new GitRuntimeError("timeout", `Git command exceeded ${timeoutMs}ms`, diagnostics)), timeoutMs);
      const onAbort = (): void => terminate(new GitRuntimeError("cancelled", "Git operation was cancelled", diagnostics));
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > this.#maxStdoutBytes) terminate(new GitRuntimeError("output-limit", "Git stdout exceeded configured limit", diagnostics));
        else stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
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
}
