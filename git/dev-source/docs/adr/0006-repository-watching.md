# ADR-0006: Per-repository watching

Статус: Accepted.

Дата: 2026-08-21.

## Context

Source files и Git metadata будут изменяться OpenCode, Codex, VS Code, npm/build, Git CLI и внешними редакторами. Obsidian vault events не покрывают все изменения.

## Decision

- Каждый ready context имеет логический `RepositoryWatcher`.
- Watch scope включает worktree и resolved gitdir/commonDir metadata.
- `RepositoryWatchCoordinator` управляет handles, keyed debounce, dirty flags, overflow и lifecycle.
- Watcher публикует targeted invalidation, но не пишет store.
- Disjoint event обновляет только target context.
- Relation propagation разрешена только contexts с observable dependent state.
- Common-dir refs/config events распространяются на все contexts `RepositoryFamily`; per-worktree HEAD/index events остаются context-local.
- Obsidian events являются дополнительным hint.

## Consequences

- External changes обнаруживаются без polling status всех repositories.
- Event storms bounded.
- Repository disappearance/return сохраняет identity.
- Shared OS handles допустимы только при сохранении repo-targeted events.
- Linked worktrees не проходят disjoint isolation assertions для shared metadata.

## Compliance

Watcher contracts generic по ID. Performance tests должны считать status invocations per repository.
