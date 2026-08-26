# ADR-0007: RepositoryTrustPolicy и GitExecutionPolicy

Статус: Accepted.

Дата: 2026-08-21.

## Context

`shell:false` предотвращает shell interpolation, но Git самостоятельно запускает hooks, credential helpers, SSH commands, filters, merge drivers, fsmonitor и external diff/textconv.

## Decision

- Auto-discovered repository имеет trust `untrusted`.
- Trust persist by `RepositoryId` и не наследуется related contexts.
- Untrusted profile разрешает только hardened read-only allowlist без network/mutation и repository-defined code execution.
- Неизвестная execution surface блокирует command fail-closed.
- Trusted profile сохраняет обычные SSH/credential/hooks workflows, но подчиняется timeout, redaction, boundary и destructive policies.
- Raw aliases/subcommands не являются public API.
- Policy принимает opaque validated plan; effects/impact не могут декларироваться caller. `network` и mutation effects проверяются независимо.
- Allowed decision выдаёт runtime-verifiable `GitExecutionPermit` для matching plan identity/digest. Boolean decision сам по себе не разрешает execution.
- Permit вместе с boundary permit и active queue lease проверяется trusted execution coordinator до выдачи `AuthorizedGitOperation`; backend не принимает bare plan.
- Permit issuance defensive-copies/freezes `disabledSurfaces` и будущие nested security collections; mutation caller-owned profile после issuance не меняет authorization semantics.

## Consequences

- Discovery/status требует safe execution profile до первого Git probe.
- Пользователь явно принимает repository-defined execution risk.
- Trust одного superproject не делает trusted submodule.
- Credential functionality trusted repositories не ломается глобальным отключением.
- Application/internal не может обойти policy прямым `context.backend.*(plan)`, поскольку parameter type и runtime verifier требуют authorized envelope конкретного issuer.

## Compliance

Contracts возвращают structured `PolicyDecision` с runtime permit. Capability tests отвергают structural/foreign-issuer permits и проверяют nested-profile immutability; security tests с sentinel commands обязательны до runtime Git core.
