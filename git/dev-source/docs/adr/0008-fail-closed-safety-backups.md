# ADR-0008: Fail-closed SafetyBackupService

Статус: Accepted.

Дата: 2026-08-21.

## Context

Discard/reset/clean/force operations могут уничтожить пользовательский код. Reflog не восстанавливает все untracked/worktree/index состояния.

## Decision

- Destructive application surface существует только в `RepositorySafetyFacade`.
- Public `GitBackend` не содержит destructive methods.
- Exact full-surface allowlist public backend/probe предотвращает escape через новый method, property, inherited member, call/index signature или function-valued property.
- Safety pipeline: runtime-verified plan, plan-bound boundary/execution permits, snapshot того же плана, verification, active participant/family queue lease, authorized envelope, plan-bound destructive permit, затем execution.
- Backup хранится вне target repository.
- Backup failure означает zero destructive invocations.
- Partial failure прекращает chain и возвращает backup reference.
- Force push default запрещён; future force update использует fresh remote OID, local protected ref и explicit lease.
- Backup request не дублирует impact. Backup/destructive permit имеют issuer-specific runtime provenance и вместе с authorized envelope связаны одним `planIdentity`, `planDigest` и `payloadDigest`; mismatch или released lease блокирует execution до process invocation.
- `pull-rebase` является destructive history rewrite и проходит этот же ref/worktree backup flow.

## Consequences

- Safety subsystem реализуется раньше discard.
- Нужен internal destructive executor, недоступный UI/application напрямую.
- Internal executor и opaque verified permit находятся в `safety/internal`; dependency rules разрешают их только safety subsystem, не Git infrastructure.
- Backup storage/manifest имеют собственные adapters и tests.
- Destructive convenience shortcuts запрещены.

## Compliance

Dependency tests запрещают UI/application/core/public-Git import safety internals. Architecture test сравнивает весь public `GitBackend` surface с exact reviewed allowlist.
