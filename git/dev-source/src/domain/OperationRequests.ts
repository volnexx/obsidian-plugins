import type { RepoRelativePath } from "./RepoRelativePath";

export type RemoteName = string & { readonly __remoteName: true };
export type LocalBranchName = string & { readonly __localBranchName: true };
export type RemoteBranchName = string & { readonly __remoteBranchName: true };
export type GitRef = string & { readonly __gitRef: true };
export type NoOperationPayload = Readonly<Record<string, never>>;

export interface DiffQuery { readonly path?: RepoRelativePath; readonly left?: GitRef; readonly right?: GitRef; readonly mode: "worktree" | "cached" | "refs"; }
export interface CommitRequest { readonly message: string; }
export interface FetchRequest { readonly remote: RemoteName; readonly refspecs: readonly string[]; readonly prune: boolean; }
export interface PullFastForwardRequest { readonly remote: RemoteName; readonly remoteBranch: RemoteBranchName; }
export interface PullMergeRequest { readonly remote: RemoteName; readonly remoteBranch: RemoteBranchName; readonly noEdit: boolean; }
export interface PullRebaseRequest { readonly remote: RemoteName; readonly remoteBranch: RemoteBranchName; readonly preserveMerges: boolean; }
export interface PushRequest { readonly remote: RemoteName; readonly source: GitRef; readonly target: GitRef; readonly setUpstream: boolean; }
export interface SetRemoteUrlRequest { readonly remote: RemoteName; readonly url: string; readonly endpoint: "fetch" | "push"; }
export interface ForceRemoteRefRequest { readonly remote: RemoteName; readonly remoteRef: GitRef; readonly sourceRef: GitRef; readonly expectedRemoteObjectId: string; readonly protectedLocalRef: GitRef; }

export interface OperationPayloadByKind {
  readonly probe: NoOperationPayload;
  readonly status: NoOperationPayload;
  readonly log: { readonly limit: number };
  readonly diff: DiffQuery;
  readonly "list-branches": NoOperationPayload;
  readonly "list-remotes": NoOperationPayload;
  readonly "read-upstream": { readonly branch: LocalBranchName };
  readonly stage: { readonly paths: readonly RepoRelativePath[] };
  readonly unstage: { readonly paths: readonly RepoRelativePath[] };
  readonly commit: CommitRequest;
  readonly checkout: { readonly branch: LocalBranchName };
  readonly "create-branch": { readonly branch: LocalBranchName };
  readonly "delete-branch": { readonly branch: LocalBranchName };
  readonly "add-remote": { readonly remote: RemoteName; readonly url: string };
  readonly "set-remote-url": SetRemoteUrlRequest;
  readonly "remove-remote": { readonly remote: RemoteName };
  readonly "set-upstream": { readonly upstream: UpstreamInfo };
  readonly "continue-operation": { readonly operation: "merge" | "rebase" | "cherry-pick" | "revert" };
  readonly fetch: FetchRequest;
  readonly "pull-ff-only": PullFastForwardRequest;
  readonly "pull-merge": PullMergeRequest;
  readonly push: PushRequest;
  readonly "pull-rebase": PullRebaseRequest;
  readonly "amend-commit": CommitRequest;
  readonly "discard-paths": { readonly paths: readonly RepoRelativePath[] };
  readonly "discard-all": NoOperationPayload;
  readonly "reset-hunk": { readonly path: RepoRelativePath; readonly patch: Uint8Array };
  readonly "reset-hard": { readonly target: GitRef };
  readonly clean: { readonly paths: readonly RepoRelativePath[] };
  readonly "force-checkout": { readonly branch: LocalBranchName };
  readonly "force-delete-branch": { readonly branch: LocalBranchName };
  readonly "abort-operation": { readonly operation: "merge" | "rebase" | "cherry-pick" | "revert" };
  readonly "force-update-remote-ref": ForceRemoteRefRequest;
}

export type OperationKind = keyof OperationPayloadByKind;
export type OperationPayload<Kind extends OperationKind> = OperationPayloadByKind[Kind];

export interface RemoteInfo { readonly name: RemoteName; readonly fetchUrl: string | null; readonly pushUrls: readonly string[]; readonly fetchRefspecs: readonly string[]; readonly pushRefspecs: readonly string[]; }
export interface UpstreamInfo { readonly localBranch: LocalBranchName; readonly remote: RemoteName; readonly remoteBranch: RemoteBranchName; readonly trackingRef: GitRef; }
export interface BranchInfo { readonly name: LocalBranchName; readonly objectId: string; readonly current: boolean; readonly upstream: UpstreamInfo | null; }
export interface CommitInfo { readonly objectId: string; readonly parents: readonly string[]; readonly subject: string; readonly authoredAt: number; }
export interface DiffResult { readonly patch: Uint8Array; readonly binary: boolean; }
