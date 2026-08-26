# ADR-0003: Portable repository identity отдельно от runtime path

Статус: Accepted.

Дата: 2026-08-21.

## Context

Absolute path меняется при переносе vault, remote URL не уникален для clone, inode нестабилен при копировании. Ни один из них не может быть persistent identity.

## Decision

- `RepositoryId` — сохранённый случайный UUID-like opaque identifier.
- Runtime использует canonical absolute realpath в `RepositoryDescriptor`.
- Repository внутри vault сохраняет `vault-relative` locator.
- External repository сохраняет отдельный locator ID, last-known path и требует explicit relink при переносе.
- Submodule может адресоваться относительно `RepositoryId` superproject.
- Remote URL используется как metadata, но не как identity.

## Consequences

- Перенос vault сохраняет UUID и per-repo settings.
- Два clones одного remote остаются разными repositories.
- Ambiguous binding не разрешается эвристически.
- Context пересоздаётся при смене runtime root, identity остаётся прежней.

## Compliance

Type contracts разделяют `RepositoryLocator` и `RepositoryDescriptor`. Architecture tests запрещают absolute-path-only identity contract.

