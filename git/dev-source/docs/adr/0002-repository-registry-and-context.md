# ADR-0002: RepositoryRegistry и RepositoryContext

Статус: Accepted.

Дата: 2026-08-21.

## Context

Global `gitManager`, `basePath`, `repository`, `RepoStore` или `gitError` несовместимы с независимыми repositories и локализацией ошибок.

## Decision

- `RepositoryRegistry` является единственным реестром contexts и path index.
- Registry принимает только contexts с resolved descriptor. Bootstrap coordinator владеет отдельным `ProvisionalRepositoryContext` до probe.
- Registry отвечает за lifecycle, lookup и events, но не выполняет Git.
- `RepositoryContext<Id>` объединяет descriptor, backend, store, queue и safety facade с одним type-level ID.
- Active repository является только UI selection.
- Provisional lifecycle: `probing`; resolved lifecycle: `ready`, `missing`, `disposing`, `disposed`.
- Provisional context содержит только ID, immutable candidate target и restricted probe backend.

## Consequences

- Ошибка/operation state принадлежит одному context.
- Bulk operation раскладывается на per-context tasks.
- Удаление repository не уничтожает identity/settings немедленно.
- Любой новый repository-scoped service должен принимать `repoId` или context-bound generic.

## Compliance

Source tests запрещают top-level singleton names. Negative type fixtures запрещают смешивать components разных IDs.
