# ADR-0004: RepositoryRelationGraph и cross-context operations

Статус: Accepted.

Дата: 2026-08-21.

## Context

Byte-for-byte isolation корректна для disjoint repositories, но не полностью описывает nested repositories и submodule/superproject. Child submodule HEAD закономерно влияет на gitlink status parent.

## Decision

- Relation graph различает `disjoint`, `nested`, `submodule-of`, `superproject-of`, `shared-common-dir`.
- Contexts с одинаковым canonical `git-common-dir` образуют `RepositoryFamily` и не считаются disjoint.
- Submodule relation требует Git topology/gitlink evidence, а не только containment.
- Nested relation имеет path-ownership projection, включая parent-tracked overlap.
- Caller не передаёт effects/impact; trusted planner формирует единый opaque single/cross-context validated plan с полными participant impacts.
- Неизвестное или запрещённое пересечение блокируется fail-closed.
- `RepositoryBoundaryPolicy` принимает весь runtime-verified plan и выдаёт runtime-verifiable permit для matching plan identity/digest; relation и participant impacts не авторизуются раздельно.
- Trusted planner вычисляет exact canonical `requiredLocks` из participants/relation/family ownership. Repository IDs, family IDs и acquisition order являются immutable частью validated plan и canonical `planDigest`.
- Lease issuer не принимает family IDs от caller: `issue(plan, acquiredAt)` выводит их только из `plan.requiredLocks`; verification требует exact repository и family equality. Missing/extra family lock блокируется.
- `CrossContextOperationCoordinator` вычисляет полный participant/family lock set, дедуплицирует его и захватывает в canonical order: lexical `RepositoryId`, затем family key. Callback запускается только после полного acquisition; partial acquisition rollback и normal release происходят в reverse order/`finally`.
- Plans с общей `RepositoryFamilyId` не могут иметь одновременно активные leases, включая linked worktrees с shared commonDir.
- Remote-ref impact содержит remote identity и target ownership. Local-path remote, являющийся context и принимающий ref mutation, требует cross-context plan с target context/family/root.
- Local-ref/config/shared-metadata mutation учитывает все affected contexts repository family.

## Consequences

- Child submodule change вызывает targeted parent refresh, но не автоматический stage gitlink.
- Broad parent checkout/reset/clean не может пересечь nested child незаметно.
- Isolation tests становятся relation/family/effect-aware.
- Cross-context orchestration не становится вторым backend.
- Единый порядок acquisition устраняет lock-order deadlock между конкурирующими cross-context operations.

## Compliance

Type contracts требуют primary/participants/plans, required lock set и plan-bound queue lease. Tests проверяют missing/extra/exact family locks, deterministic acquisition order, active-lease provenance, disjoint isolation и разрешённые relation effects.
