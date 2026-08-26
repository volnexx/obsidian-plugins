# ADR-0010: Dependency direction и единая Git execution boundary

Статус: Accepted.

Дата: 2026-08-21.

## Context

Если UI, hunk view или automation могут запускать Git напрямую, они обходят queue, trust, safety, cancellation и repository targeting.

## Decision

- Dependency direction следует `UI -> application -> domain ports <- infrastructure`.
- Только `git/infrastructure` может импортировать child-process/simple-git.
- UI импортирует только `src/application/public/**`, UI-common и external UI API. Весь будущий `application/internal/**`, а также direct core/context, git, queue, safety, mutable store и watcher запрещены.
- `main.ts` является только composition root.
- Cycles запрещены.
- Architecture rules проверяются dependency-cruiser и AST tests.
- Stage 1 запрещает любой runtime Git execution даже внутри разрешённого будущего layer.
- `GitBackend -> state/RepoStore` dependency запрещена.
- Safety internal executor разрешён только внутри safety subsystem.
- Проверяемая layer matrix запрещает `domain|core|state|operations|safety|watching|git -> application|ui` и `application -> ui`.

## Consequences

- Infrastructure заменяема и тестируема через ports.
- UI не может получить `RepositoryContext` и вызвать `context.backend` напрямую.
- Wiring сосредоточен в composition root.
- Добавление нового execution path требует изменения architecture rules/ADR.

## Compliance

CI запускает dependency graph validation, source AST tests, type fixtures, lint и build.
