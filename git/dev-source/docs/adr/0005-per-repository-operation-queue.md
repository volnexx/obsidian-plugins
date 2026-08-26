# ADR-0005: Per-repository OperationQueue

Статус: Accepted.

Дата: 2026-08-21.

## Context

Git commands одного repository могут конфликтовать через index/ref locks. Одна global queue необоснованно блокирует независимые repositories. Зависший network/helper process не должен блокировать queue навсегда.

## Decision

- Каждый context владеет отдельной FIFO queue.
- Все Git reads/writes одного context проходят через неё.
- Disjoint contexts выполняются параллельно.
- Queue принимает только trusted `ValidatedOperationPlan`, включающий repo ID, operation ID, typed payload, centrally derived orthogonal effects, complete participant impacts, identity/digests, origin, signal и deadline.
- Abort/timeout должны освобождать slot в `finally`.
- Cross-context coordinator получает все participant queues и family locks в одном canonical lexical order, не запускает operation до полного acquisition и освобождает partial/full lease set в reverse order внутри `finally`.
- Active `ParticipantQueueLease` привязан к plan identity/digest и становится обязательной частью `AuthorizedGitOperation`; после release envelope больше не проходит runtime verification.
- Required repository/family lock set вычисляется planner и входит в plan digest. Lease authority не принимает отдельный family set и копирует exact `plan.requiredLocks`; `verifyActive` повторно сравнивает repository IDs, family IDs и acquisition order.
- Automatic retry разрешён только явно idempotent operations после state probe.
- Retry decision принимает полный effect vector; `network` не скрывает mutation local/remote refs, index или worktree.

## Consequences

- Same-repo operations сериализованы.
- Один зависший repository не блокирует остальные.
- Runner обязан уметь завершать process tree и cleanup resources.
- После cancelled mutation store остаётся unknown до authoritative refresh.
- Shared-common-dir worktrees сериализуют ref/config/commonDir-affecting plans через общий family lock.

## Compliance

Type tests требуют `repoId`/signal/deadline и запрещают backend call с bare plan. Architecture/unit tests проверяют contract shape, missing/extra/exact family locks, canonical order, lease invalidation и отсутствие global queue.
