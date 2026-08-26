# ADR-0012: Trusted operation planning и plan-bound authorization

Статус: Accepted.

Дата: 2026-08-22.

## Context

Caller-supplied effects/impact позволяют занизить mutation или destructive semantics. Один generic pull kind также не может одновременно корректно описать ff-only, merge и history-rewriting rebase. Отдельные backup, boundary и executor payloads допускают TOCTOU-подмену target.

## Decision

- Caller создаёт только typed `OperationIntent(repoId, operationId, kind, payload, signal, deadline)` без effects/impact.
- Единственный trusted `OperationPlanner` выводит exact effects из exhaustive central map, canonicalizes payload, resolves all participant/family impacts и exact required repository/family lock set, затем создаёт runtime-verifiable immutable `ValidatedOperationPlan`.
- Planner runtime validation fail-closed при effects mismatch, неизвестном payload, unresolved ownership или incomplete impact.
- `pull-ff-only`, `pull-merge` и destructive `pull-rebase` являются разными operation kinds.
- Plan имеет opaque `planIdentity`, canonical `payloadDigest` и `planDigest` полного payload/effects/scope/impacts/requiredLocks.
- Boundary policy принимает единый single/cross-context plan union и выдаёт opaque permit только для этого plan identity.
- Runtime opacity обеспечивается authority-specific provenance registry и непубличным construction token, а не только TypeScript brand. Structural JS object или capability другого authority instance не валидны.
- `GitOperationExecutionCoordinator` является единственным переходом от validated plan к execution: plan verification → boundary permit → Git execution permit → all-participant/family queue lease → `AuthorizedGitOperation`.
- Public `GitBackend` принимает только authorized envelope; bare plan отвергается compile-time и runtime.
- Cross-context coordinator использует единый canonical lock order и `finally` release; активный lease входит в envelope и инвалидируется при release.
- Lease authority использует только `issue(plan, acquiredAt)` и проверяет exact plan-required repository/family lock set. Caller-supplied family lists запрещены.
- Authorized verifier требует expected backend `repositoryId` и exact method `OperationKind` через `verifyFor`; generic TypeScript parameter не считается runtime boundary.
- Plan/permit/lease issuance defensive-copies and freezes nested authorization data, чтобы caller-owned references не могли изменить semantics после issuance.
- Backup, destructive permit и executor используют тот же identity/digests. Executor обязан сравнить их fail-closed до invocation.
- Remote-ref impact идентифицирует remote и registered local target context/family/root либо canonical external URL digest.

## Consequences

- Caller не может объявить read-only effects для mutating request.
- Backup target A невозможно переиспользовать для destructive target B.
- Cross-context relation и participant impacts авторизуются атомарно.
- Application/internal может владеть context reference, но не может выполнить backend до получения authorized envelope от trusted coordinator.
- Добавление request-dependent safety требует нового operation kind или изменения planner contract/ADR.

## Compliance

Type fixtures запрещают caller effects, forging capabilities, general verifier без expected target/kind и direct backend call с bare plan. Unit tests проверяют exact effect matrix, missing/extra/exact family locks, runtime Repo B/wrong-kind rejection, nested immutability, provenance и post-release invalidation. Architecture tests проверяют mandatory envelope и plan/digest-bound lock contracts.
