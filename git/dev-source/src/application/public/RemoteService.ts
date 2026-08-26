import type {
  FetchRequest,
  LocalBranchName,
  PullFastForwardRequest,
  PullMergeRequest,
  PullRebaseRequest,
  PushRequest,
  RemoteInfo,
  RemoteName,
  UpstreamInfo
} from "../../domain/OperationRequests";
import type { RepositoryId } from "../../domain/RepositoryId";

/** UI-facing application facade; implementations plan, authorize and queue every command. */
export interface RemoteService {
  listRemotes(repoId: RepositoryId): Promise<readonly RemoteInfo[]>;
  getRemoteUrl(repoId: RepositoryId, remote: RemoteName, endpoint: "fetch" | "push"): Promise<string | null>;
  addRemote(repoId: RepositoryId, remote: RemoteName, url: string): Promise<void>;
  setRemoteUrl(repoId: RepositoryId, remote: RemoteName, url: string, endpoint: "fetch" | "push"): Promise<void>;
  removeRemote(repoId: RepositoryId, remote: RemoteName): Promise<void>;
  readUpstream(repoId: RepositoryId, localBranch: LocalBranchName): Promise<UpstreamInfo | null>;
  setUpstream(repoId: RepositoryId, upstream: UpstreamInfo): Promise<void>;
  fetch(repoId: RepositoryId, request: FetchRequest): Promise<void>;
  pullFastForward(repoId: RepositoryId, request: PullFastForwardRequest): Promise<void>;
  pullMerge(repoId: RepositoryId, request: PullMergeRequest): Promise<void>;
  pullRebase(repoId: RepositoryId, request: PullRebaseRequest): Promise<void>;
  push(repoId: RepositoryId, request: PushRequest): Promise<void>;
}
