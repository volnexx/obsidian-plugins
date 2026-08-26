import { createHash } from "node:crypto";

import type { CanonicalAbsolutePath } from "../../domain/RepoRelativePath";
import type { RepositoryFamilyId, RepositoryId } from "../../domain/RepositoryId";
import type { RepositoryProbeResult, RepositoryProbeTarget } from "../../domain/RepositoryProbe";
import type { ValidatedOperationPlan, ValidatedOperationPlanVerifier } from "../../domain/ValidatedOperationPlan";
import type { RepositoryProbeBackend } from "../RepositoryProbeBackend";
import { GitRuntimeError } from "../GitErrors";
import { canonicalizeExistingPath } from "./CanonicalPath";
import type { DesktopGitCommandRunner } from "./GitCommandRunner";

const familyIdFor = (commonDir: CanonicalAbsolutePath): RepositoryFamilyId =>
  `family:${createHash("sha256").update(commonDir).digest("hex")}` as RepositoryFamilyId;

export class DesktopRepositoryProbeBackend<Id extends RepositoryId = RepositoryId> implements RepositoryProbeBackend<Id> {
  readonly runtime = "desktop-system-git-probe" as const;
  readonly repositoryId: Id;
  readonly target: RepositoryProbeTarget<Id>;

  constructor(target: RepositoryProbeTarget<Id>, private readonly runner: DesktopGitCommandRunner, private readonly planVerifier: ValidatedOperationPlanVerifier) {
    this.repositoryId = target.repoId;
    this.target = Object.freeze({ ...target, locator: Object.freeze({ ...target.locator }) });
    Object.freeze(this);
  }

  async probe(plan: ValidatedOperationPlan<Id, "probe">): Promise<RepositoryProbeResult<Id>> {
    if (!this.planVerifier.verify(plan) || plan.repoId !== this.repositoryId) {
      throw new TypeError("Probe requires a genuine validated plan for its immutable candidate target");
    }
    const layout = await this.runner.runProbe(this.target, plan.operationId, "probe-layout", plan.signal, plan.deadlineAt);
    const lines = new TextDecoder().decode(layout.stdout).replace(/\r\n/gu, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (lines.length < 4) throw new GitRuntimeError("invalid-output", "Git probe returned an incomplete repository layout", { repositoryId: this.repositoryId, operationId: plan.operationId, command: "probe-layout" });
    const [rootText, gitDirText, commonDirText, insideText, superprojectText = ""] = lines;
    if (rootText === undefined || gitDirText === undefined || commonDirText === undefined || insideText !== "true") {
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
}
