# ADR-0009: RemoteService без provider assumptions

Статус: Accepted.

Дата: 2026-08-21.

## Context

Repositories могут иметь произвольные remotes, fetch/push URLs, refspecs и upstream branches. `origin/main` и GitHub API не являются универсальной Git-моделью.

## Decision

- `RemoteService` — application port поверх того же context-bound backend.
- API поддерживает list/get/add/set/remove remote и read/set upstream.
- Fetch/pull/push получают explicit remote/refspec либо проверенный configured upstream.
- `origin`, `main`, `master` не используются как fallback.
- GitHub API не требуется для обычного remote management.
- Remote mutation проходит context queue и trust policy.
- Effects ортогональны: fetch = network + local refs/metadata; pull-ff-only/merge дополнительно index/worktree; pull-rebase также destructive; push = network + remote refs.
- Remote impact содержит remote name и resolved target identity. Local target context ref mutation становится cross-context operation.

## Consequences

- Detached/no-upstream/missing-remote являются typed states.
- Provider-specific функции могут добавляться отдельно.
- Pull strategies являются разными typed operation kinds, а не flag одного kind.
- Force update не является опцией обычного push.

## Compliance

Type contracts требуют remote/upstream arguments. Architecture tests запрещают hardcoded default remote/branch literals в service layer.
