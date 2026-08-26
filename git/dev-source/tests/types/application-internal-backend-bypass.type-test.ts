import type { RepositoryContext } from "../../src/core/RepositoryContext";
import type { RepositoryId } from "../../src/domain/RepositoryId";
import type { ValidatedOperationPlan } from "../../src/domain/ValidatedOperationPlan";

type Repo = RepositoryId<"application-internal-bypass">;
declare const context: RepositoryContext<Repo>;
declare const plan: ValidatedOperationPlan<Repo, "status">;

// Negative fixture: application/internal cannot execute a backend with a bare validated plan.
// @ts-expect-error GitBackend requires an AuthorizedGitOperation issued after both policies and queue acquisition.
void context.backend.status(plan);
