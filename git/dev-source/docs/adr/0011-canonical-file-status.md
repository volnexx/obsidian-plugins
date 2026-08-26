# ADR-0011: Canonical FileStatusEntry

Статус: Accepted.

Дата: 2026-08-21.

## Context

Один path может одновременно иметь изменения index/worktree, rename/copy metadata и conflict stages. Независимые staged/unstaged/deleted/renamed collections теряют эту связь.

## Decision

- Domain `RepositoryObservation`/`BranchState` являются backend result; immutable `FileStatusEntry[]` является единственным file status source of truth.
- Entry хранит path/originalPath, index/worktree status, untracked, conflict stages, rename/copy metadata и submodule state.
- UI collections являются derived projections одного generation.
- `RepoStore` не предоставляет независимые setters для projections.
- Store самостоятельно добавляет generation/confidence/lifecycle/applied timestamp; backend не назначает store metadata.

## Consequences

- Один файл может отображаться в staged и unstaged UI без дублирования source data.
- Porcelain parser обязан сохранять record semantics.
- Fingerprint и refresh generation строятся из canonical snapshot.

## Compliance

Type contracts не содержат mutable projection arrays. Negative fixtures и source tests защищают shape.
