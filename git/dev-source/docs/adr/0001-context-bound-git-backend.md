# ADR-0001: Один context-bound GitBackend

Статус: Accepted.

Дата: 2026-08-21.

## Context

Плагин должен управлять десятками независимых repositories. Разделение status, commit, diff и network operations между разными engines создаёт несовместимые semantics и скрытую зависимость от global cwd.

## Decision

- Bootstrap использует отдельный `RepositoryProbeTarget` и restricted `RepositoryProbeBackend` с единственным методом `probe`.
- До probe известны `repoId`, locator и immutable canonical candidate root; `gitDir`/`commonDir` ещё не существуют в descriptor contract.
- Успешный hardened probe возвращает resolved descriptor; только после этого создаётся final `DesktopGitBackend`.
- Один `RepositoryContext` владеет одним `GitBackend`.
- Backend generic по `RepositoryId` и навсегда связан с immutable `RepositoryDescriptor.runtimeRoot`.
- Backend methods не принимают execution target (`cwd`, `-C`, `--git-dir`, `--work-tree`).
- Desktop runtime в будущем реализует один `DesktopGitBackend`; system Git/simple-git могут быть только transport details внутри него.
- Caller создаёт typed intent; policies/queue работают с runtime-verified `ValidatedOperationPlan`, а backend calls получают только `AuthorizedGitOperation` с matching plan, boundary permit, Git execution permit и active participant/family queue lease.
- Bare validated plan не является backend execution capability. Backend verifier связан с конкретным authorized-operation authority instance и отклоняет structural objects, foreign issuer capabilities и released leases.
- Backend verifier API требует `verifyFor(candidate, backend.repositoryId, exactMethodKind)`. Genuine capability другого repository или другого operation kind не авторизует method invocation даже при корректной provenance.
- Public backend не предоставляет raw command или destructive surface.
- Полная public backend/probe surface проверяется exact reviewed allowlist: properties, methods, отсутствие function-valued properties, call/index/construct signatures и heritage.
- Backend возвращает domain observations и не импортирует `RepoStore`/state metadata.
- Ordinary commit не принимает amend flag; amend проходит отдельный safety/ref-backup flow.
- Pull strategies имеют отдельные kinds; destructive `pull-rebase` отсутствует в public backend.

## Consequences

- Нельзя смешивать несколько Git engines по операциям.
- Перемещение repository требует нового context lifecycle.
- Provisional context не может быть использован как resolved context.
- UI и application не могут произвольно retarget backend.
- Mobile backend может быть добавлен за тем же port без изменения domain/application.

## Compliance

Type-level tests проверяют совпадение IDs. Runtime tests проверяют Repo B/Repo A и status/stage rejection. Architecture tests запрещают retarget fields и concrete backend imports из UI.
