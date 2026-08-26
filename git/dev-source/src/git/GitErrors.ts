import type { OperationId, RepositoryId } from "../domain/RepositoryId";

export type GitErrorCode =
  | "git-not-found"
  | "not-a-repository"
  | "candidate-root-mismatch"
  | "command-failed"
  | "timeout"
  | "cancelled"
  | "output-limit"
  | "invalid-output"
  | "invalid-command"
  | "repository-missing";

export interface GitDiagnosticContext {
  readonly repositoryId: RepositoryId | "process";
  readonly operationId: OperationId | "git-capability";
  readonly command: string;
}

export class GitRuntimeError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
    readonly diagnostics: GitDiagnosticContext,
    readonly exitCode: number | null = null,
    readonly stderr = ""
  ) {
    super(message);
    this.name = "GitRuntimeError";
  }
}
