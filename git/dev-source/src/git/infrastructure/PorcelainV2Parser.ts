import type { FileStatusEntry, GitIndexStatus, GitWorktreeStatus, IndexStageMetadata, SubmoduleStatus } from "../../domain/FileStatusEntry";
import type { RepoRelativePath } from "../../domain/RepoRelativePath";
import type { RepositoryId } from "../../domain/RepositoryId";
import type { BranchState, RepositoryObservation } from "../../domain/RepositorySnapshot";
import { GitRuntimeError, type GitDiagnosticContext } from "../GitErrors";

const decoder = new TextDecoder("utf-8", { fatal: true });
const decode = (value: Uint8Array): string => decoder.decode(value);
const asPath = (value: Uint8Array): RepoRelativePath => decode(value) as RepoRelativePath;

const splitNul = (input: Uint8Array): Uint8Array[] => {
  const records: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) if (input[index] === 0) {
    records.push(input.subarray(start, index));
    start = index + 1;
  }
  if (start !== input.length) throw new TypeError("Porcelain v2 -z output is not NUL terminated");
  return records;
};

const splitAsciiPrefix = (record: Uint8Array, fieldCount: number): { readonly fields: readonly string[]; readonly rest: Uint8Array } => {
  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < record.length && fields.length < fieldCount; index += 1) if (record[index] === 0x20) {
    fields.push(decode(record.subarray(start, index)));
    start = index + 1;
  }
  if (fields.length !== fieldCount) throw new TypeError("Malformed porcelain v2 record");
  return { fields, rest: record.subarray(start) };
};

const indexStatus = (value: string): GitIndexStatus => ({ ".": "unmodified", " ": "unmodified", A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type-changed", U: "unmerged" })[value] as GitIndexStatus | undefined ?? (() => { throw new TypeError(`Unknown index status ${value}`); })();
const worktreeStatus = (value: string): GitWorktreeStatus => ({ ".": "unmodified", " ": "unmodified", M: "modified", D: "deleted", T: "type-changed", U: "unmerged" })[value] as GitWorktreeStatus | undefined ?? (() => { throw new TypeError(`Unknown worktree status ${value}`); })();
const submoduleStatus = (value: string): SubmoduleStatus | undefined => value.startsWith("S") ? {
  commitChanged: value[1] === "C",
  trackedChanges: value[2] === "M",
  untrackedChanges: value[3] === "U"
} : undefined;
const stage = (mode: string, objectId: string): IndexStageMetadata | undefined => /^0+$/u.test(mode) || /^0+$/u.test(objectId) ? undefined : { mode, objectId };

export const parsePorcelainV2Status = <Id extends RepositoryId>(repositoryId: Id, input: Uint8Array, observedAt: number, diagnostics: GitDiagnosticContext): RepositoryObservation<Id> => {
  try {
    const records = splitNul(input);
    const files: FileStatusEntry[] = [];
    let head: string | null = null;
    let detached = false;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record === undefined || record.length === 0) continue;
      if (record[0] === 0x23) {
        const header = decode(record);
        if (header.startsWith("# branch.head ")) {
          const value = header.slice(14);
          detached = value === "(detached)";
          head = detached || value === "(unknown)" ? null : value;
        } else if (header.startsWith("# branch.upstream ")) upstream = header.slice(18);
        else if (header.startsWith("# branch.ab ")) {
          const match = /^# branch\.ab \+(\d+) -(\d+)$/u.exec(header);
          if (match !== null) { ahead = Number(match[1]); behind = Number(match[2]); }
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
        files.push({ path: asPath(rest), indexStatus: indexStatus(xy[0] ?? "."), worktreeStatus: worktreeStatus(xy[1] ?? "."), untracked: false, changeKind: "ordinary", ...(submodule === undefined ? {} : { submoduleState: submodule }) });
        continue;
      }
      if (marker === "2") {
        const { fields, rest } = splitAsciiPrefix(record, 9);
        const original = records[index + 1];
        if (original === undefined) throw new TypeError("Rename/copy record has no original pathname");
        index += 1;
        const xy = fields[1] ?? "..";
        const scoreField = fields[8] ?? "R0";
        const kind = scoreField.startsWith("C") ? "copy" : "rename";
        const submodule = submoduleStatus(fields[2] ?? "N...");
        files.push({ path: asPath(rest), originalPath: asPath(original), indexStatus: indexStatus(xy[0] ?? "."), worktreeStatus: worktreeStatus(xy[1] ?? "."), untracked: false, changeKind: kind, similarity: Number(scoreField.slice(1)), ...(submodule === undefined ? {} : { submoduleState: submodule }) });
        continue;
      }
      if (marker === "u") {
        const { fields, rest } = splitAsciiPrefix(record, 10);
        const xy = fields[1] ?? "UU";
        const base = stage(fields[3] ?? "0", fields[7] ?? "0");
        const ours = stage(fields[4] ?? "0", fields[8] ?? "0");
        const theirs = stage(fields[5] ?? "0", fields[9] ?? "0");
        files.push({ path: asPath(rest), indexStatus: indexStatus(xy[0] ?? "U"), worktreeStatus: worktreeStatus(xy[1] ?? "U"), untracked: false, changeKind: "unmerged", conflictStages: { ...(base === undefined ? {} : { base }), ...(ours === undefined ? {} : { ours }), ...(theirs === undefined ? {} : { theirs }) } });
        continue;
      }
      throw new TypeError(`Unsupported porcelain v2 record marker ${marker}`);
    }
    const branch: BranchState = Object.freeze({ head, detached, upstream, ahead, behind });
    return Object.freeze({ repositoryId, branch, files: Object.freeze(files.map((file) => Object.freeze(file))), observedAt });
  } catch (error) {
    throw new GitRuntimeError("invalid-output", error instanceof Error ? error.message : String(error), diagnostics);
  }
};
