# Git: нормативная архитектура

Статус: architecture baseline утверждён; активный gate — этап 2 read-only Git core.

Дата последнего изменения: 2026-08-22.

Этот документ нормативен для проекта Obsidian-плагина `git`. Исследовательские основания и анализ доноров находятся в `ARCHITECTURE_RESEARCH.md`. При расхождении после принятия ADR приоритет имеют: принятый ADR, затем этот документ, затем исследовательский документ.

Термины `MUST`, `MUST NOT`, `SHOULD` и `MAY` обозначают обязательность архитектурного правила.

## 1. Scope и stage gates

### 1.1 Завершённый этап 1

Этап 1 создаёт только:

- нормативную архитектуру и ADR;
- type-level contracts;
- минимальный Obsidian scaffold;
- dependency-boundary, type-invariant и architecture tests;
- лицензионные документы.

Этап 1 MUST NOT содержать:

- запуск `git` или другого VCS process;
- реализацию `DesktopGitBackend`;
- discovery, status parsing, watcher runtime или remote operations;
- stage, commit, fetch, pull, push, checkout, reset, clean либо backup runtime;
- UI Git-функциональность.

### 1.2 Разрешённый этап 2

После явного утверждения этапа 1 разрешены только desktop discovery/runtime infrastructure и local read-only Git core:

- единственный context-free process `git --version`;
- restricted probe: `rev-parse` для toplevel/git-dir/common-dir/worktree/superproject/object-format;
- чтение имён command-executing local config keys через exact `config --local --null --name-only --get-regexp` для их последующего neutralizing override; config values не возвращаются application/UI и config не изменяется;
- `status --porcelain=v2 -z --branch --untracked-files=all --ignore-submodules=dirty`;
- provisional discovery, resolved contexts, relation/family graph, per-context stores/queues и минимальная diagnostic UI projection.

Любые network или mutating commands, watcher runtime, backup runtime, mobile backend и stage-3 UI остаются запрещены. Exact stage-2 command surface MUST быть allowlisted и architecture-tested.

## 2. Нормативные инварианты

### 2.1 Инвариант принадлежности

> Любая Git-операция однозначно принадлежит одному `RepositoryContext`.

- Обычная операция MUST иметь `repoId` и ровно один primary context.
- Cross-context operation MUST иметь один primary context и явный непустой набор participant contexts.
- Caller создаёт только typed `OperationIntent`; он MUST NOT объявлять effects, impact или participants.
- Только trusted central `OperationPlanner` MAY создать runtime-verifiable `ValidatedOperationPlan`. Policies и queue coordinator принимают validated plan, но `GitBackend` MUST принимать только runtime-verifiable `AuthorizedGitOperation`, выданный после boundary authorization, Git execution authorization и получения всех participant/family queue leases.
- Final backend MUST быть создан для одного immutable resolved runtime root и MUST NOT принимать новый `cwd`, `-C`, `--git-dir` или `--work-tree` от caller. Restricted probe backend отдельно связан с immutable candidate target.
- Global active repository MAY существовать только как UI selection; он MUST NOT определять execution target.

### 2.2 Инвариант границы

> Ни одна mutating Git-операция не может изменить файлы или refs другого `RepositoryContext` без явно смоделированной cross-context relation/operation.

- Каждый validated plan MUST иметь planner-derived `OperationEffects` и полный `OperationImpactPlan` каждого participant. Impact MUST отдельно описывать worktree paths, index, Git config, repository-local metadata, local refs и remote refs.
- Неопределимый или пересекающий неизвестную repository boundary план MUST быть отклонён fail-closed.
- Byte-for-byte isolation MUST применяться только к contexts, которые не имеют root containment, не разделяют `git-common-dir` и не являются participants explicit cross-context operation.
- Для `nested`, `submodule-of`, `superproject-of` и `shared-common-dir` MUST проверяться только явно разрешённые relation/effect consequences.
- Изменение HEAD child submodule MAY сделать gitlink status superproject dirty; это MUST вызвать targeted invalidation parent и MUST NOT считаться нарушением isolation.

## 3. Dependency direction

```text
Obsidian adapter / UI / commands
                |
                v
Application services and controllers
                |
                v
Domain contracts and core repository model
                ^
                |
Infrastructure adapters: Git, filesystem, watchers, backup storage

main.ts = composition root only
```

Правила:

- `domain/` MUST NOT импортировать Obsidian, Node filesystem/process APIs, UI, application или infrastructure.
- `core/`, `state/` и `operations/` MAY зависеть от domain contracts, но MUST NOT запускать external processes.
- `authorization/` содержит только runtime capability/envelope primitives, зависит только от domain и MUST NOT импортироваться application/UI.
- `application/internal/` MAY зависеть от domain/core/state/operations/safety ports, но MUST NOT импортировать concrete Git infrastructure или UI.
- `application/public/` является единственной surface, доступной UI; public contracts MAY импортировать immutable domain values/requests, но MUST NOT импортировать internals, contexts, backends, queues, safety, stores или watchers.
- `ui/` MAY импортировать только `application/public/`, `ui/` common code и external Obsidian UI API. Разрешение всего `application/**` запрещено.
- Direct UI imports из `core/`, `git/`, `operations/`, `safety/`, `state/` и `watching/` MUST быть запрещены. Immutable domain values для UI MUST re-export через application public surface.
- Только `git/infrastructure/` MAY импортировать `node:child_process`, `child_process` или `simple-git`.
- `git/infrastructure/` MUST NOT экспортироваться в UI.
- `main.ts` MAY создавать adapters/services и регистрировать Obsidian lifecycle objects, но MUST NOT содержать domain logic, Git commands, status state или repository selection logic.
- Cyclic dependencies MUST быть запрещены автоматически.
- `domain|authorization|core|state|operations|safety|watching|git -> application|ui` и `application -> ui` MUST быть запрещены автоматически.

## 4. Repository identity и paths

`RepositoryId` — opaque UUID-like brand. Persistent settings MUST key by `RepositoryId`, а не absolute path или remote URL. `RepositoryFamilyId` идентифицирует contexts с общим canonical `git-common-dir`.

`RepoRelativePath` — opaque normalized path относительно immutable repository root. Он MUST NOT содержать absolute path, NUL или traversal за root.

Runtime и persistence разделены:

- `RepositoryProbeTarget.candidateRoot` — canonical candidate realpath, immutable до probe;
- resolved `RepositoryDescriptor.runtimeRoot`, `gitDir` и `commonDir` появляются только после успешного probe;
- `RepositoryLocator` — persistent locator;
- repository внутри vault MUST использовать `vault-relative` locator;
- external repository MUST использовать отдельный `external` locator с stable locator ID и explicit relink;
- submodule MAY использовать locator относительно `RepositoryId` superproject;
- перенос vault MUST сохранять `RepositoryId` и per-repo settings.

Bootstrap model:

```text
repoId + locator + immutable candidateRoot
  -> RepositoryProbeTarget
  -> ProvisionalRepositoryContext + restricted RepositoryProbeBackend
  -> hardened probe result
  -> resolved RepositoryDescriptor + RepositoryFamilyId
  -> final RepositoryContext + immutable DesktopGitBackend
```

До probe MUST NOT создаваться фиктивные `gitDir`/`commonDir`. Probe intent всё равно MUST иметь explicit `repoId`, deadline/signal, а trusted planner MUST привязать validated probe plan к immutable candidate execution target. Restricted probe backend MUST иметь exact reviewed full surface: properties `repositoryId`/`target`, единственный method `probe`, без heritage, call/index signatures или function-valued properties; он MUST NOT быть final `GitBackend`.

## 5. RepositoryRegistry и RepositoryContext

`RepositoryRegistry` является единственным владельцем resolved contexts и path index. Он отвечает за lifecycle, lookup, rediscovery coordination и events, но MUST NOT выполнять Git-команды. Provisional contexts существуют в bootstrap coordinator и регистрируются окончательно только после успешного hardened probe.

Каждый `RepositoryContext<Id>` MUST агрегировать значения с одним и тем же type-level ID:

```text
RepositoryContext<Id>
  descriptor: RepositoryDescriptor<Id>
  backend: GitBackend<Id>
  store: RepoStore<Id>
  queue: OperationQueue<Id>
  safety: RepositorySafetyFacade<Id>
```

Provisional lifecycle — `probing`; resolved context lifecycle — `ready | missing | disposing | disposed`.

- `runtimeRoot` MUST быть immutable.
- Context MUST NOT быть singleton.
- Repository-local error MUST принадлежать соответствующему store/context.
- Missing/disposed context MUST отклонять новые operations.
- `ProvisionalRepositoryContext<Id>` MUST содержать только ID, lifecycle `probing`, immutable candidate target и restricted probe backend; он MUST NOT притворяться полноценным `RepositoryContext`.

## 6. RepositoryRelationGraph и cross-context operations

Relation model MUST различать:

- `disjoint`;
- `nested`;
- `submodule-of`;
- `superproject-of`.
- `shared-common-dir`.

`RepositoryRelationGraph` MUST вычисляться из canonical roots и подтверждённой Git topology. Path containment сам по себе MUST NOT доказывать submodule relation.

Contexts с разными worktree roots, но одинаковым canonical `commonDir`, образуют `RepositoryFamily` и MUST иметь relation `shared-common-dir`. Они не являются `disjoint`: refs, remotes/config и часть metadata принадлежат общей family, тогда как HEAD/index/worktree могут оставаться context-local.

Для nested repositories MUST существовать path-ownership projection:

- opaque/ignored child boundary;
- child path, одновременно tracked parent;
- unknown ownership.

Parent или child mutation при tracked overlap MUST быть заблокирована либо оформлена как explicit cross-context operation.

Opaque `ValidatedOperationPlan` MUST содержать единый scope union: `single-context` либо `cross-context`. Cross-context scope MUST содержать:

- primary `repoId`;
- participant IDs;
- relation kind;
- полный `OperationImpactPlan` по каждому participant/family ownership domain;
- полный participant/family ownership set, из которого coordinator выводит deterministic queue acquisition order.

`RepositoryBoundaryPolicy` MUST принимать весь validated plan, проверять relation и полный participant/family impact set как одни связанные данные и возвращать opaque permit, привязанный к `planIdentity`/`planDigest`. Отдельная проверка relation, не связанная с авторизованным impact, запрещена.

Trusted `OperationPlanner` MUST вычислить canonical `requiredLocks` как часть immutable plan: exact sorted repository IDs, exact sorted `RepositoryFamilyId` set и combined acquisition order. `requiredLocks` MUST входить в canonical `planDigest`; caller/queue coordinator не может добавлять или удалять family locks. Integrity verifier MUST сверять этот set с relation graph/family ownership. `shared-common-dir` plan без family lock отклоняется при issuance.

`CrossContextOperationCoordinator` MUST сначала вычислить полный набор repository и family locks, дедуплицировать его и захватывать в едином canonical lexicographic порядке `RepositoryId`, затем family key. Backend callback MUST начаться только после получения всех leases. При ошибке частичного acquisition уже полученные leases MUST освобождаться в обратном порядке; после callback все leases MUST освобождаться в `finally`. Два plans с общей `RepositoryFamilyId` MUST NOT иметь одновременно активные leases, даже если worktree roots различны.

Lease issuer MUST иметь форму `issue(plan, acquiredAt)` или проверять внешний set на exact equality. Baseline использует первую форму: repository/family locks копируются только из `plan.requiredLocks`. `verifyActive` MUST проверять exact equality repository IDs, family IDs и acquisition order; missing и extra locks fail closed.

Git metadata ownership определяется resolved gitdir/ref namespace. Физическое расположение submodule metadata в `.git/modules/...` superproject не делает child refs refs родителя.

Operation с `mutatesLocalRefs`, `mutatesGitConfig` или shared `mutatesGitMetadata` MUST учитывать все affected contexts одной `RepositoryFamily`. Remote-ref impact MUST содержать remote name и target identity: registered `RepositoryContext`/family/canonical root для local-path remote либо canonical external URL digest. Одних ref strings недостаточно. Common-dir watcher event MUST invalidating все family contexts; worktree/index event остаётся target-local, если нет другой relation.

## 7. GitBackend

Bootstrap и normal runtime используют разные ограниченные ports:

- `RepositoryProbeBackend<Id>` связан с immutable `RepositoryProbeTarget<Id>` и имеет только `probe`;
- после успешного probe создаётся resolved descriptor;
- только затем создаётся context-bound `DesktopGitBackend<Id>`.

В normal desktop runtime MUST существовать ровно один Git backend implementation: context-bound `DesktopGitBackend`.

- Backend contract generic по `RepositoryId`.
- Backend instance MUST иметь immutable `repositoryId` и descriptor.
- Caller передаёт typed intent в `OperationPlanner`. Backend async calls MUST получать только `AuthorizedGitOperation<Id, Kind>`, содержащий matching validated plan, boundary permit, Git execution permit и активный participant queue lease.
- Bare `ValidatedOperationPlan` не является execution capability и MUST NOT приниматься ни одним method public `GitBackend`.
- Backend implementation MUST иметь injected `AuthorizedGitOperationVerifier` конкретного trusted authority instance и вызвать `verifyFor(candidate, this.repositoryId, exactMethodKind)` до process invocation. Проверяются provenance, active lease, `operation.plan.repoId === backend.repositoryId` и `operation.plan.kind === exact method kind`; structural lookalike, capability другого issuer/Repo B, wrong-kind capability, plan/permit mismatch и released lease отклоняются fail closed.
- Backend requests MUST NOT содержать execution retargeting fields.
- System Git/simple-git/argv transport являются внутренней инфраструктурной деталью одного backend, а не параллельными engines.
- UI, automation, hunk, remote и conflict code MUST NOT запускать Git напрямую.
- Публичный `GitBackend` MUST NOT предоставлять raw command API.
- Публичный `GitBackend` MUST NOT предоставлять destructive commands в обход `RepositorySafetyFacade`.
- Полная surface `GitBackend` и `RepositoryProbeBackend` MUST проверяться exact reviewed allowlist: properties и methods, отсутствие function-valued escape properties, call/index/construct signatures, heritage/extends и неизвестных members. Проверка только `MethodSignature` недостаточна.
- `GitBackend` MUST возвращать только domain observations/results и MUST NOT импортировать `state/RepoStore` или назначать store generation/confidence.
- Ordinary `commit` MUST NOT принимать `amend` flag. Amend — отдельная destructive/history-rewrite operation через safety/ref-backup policy.
- Generic `pull` с request-dependent safety запрещён. `pull-ff-only`, `pull-merge` и `pull-rebase` являются разными `OperationKind`; `pull-rebase` имеет `destructive=true`, отсутствует в public backend и проходит safety/ref-backup policy.

На этапе 2 public `GitBackend` имеет exact surface `repositoryId`, `descriptor`, `status(AuthorizedGitOperation<Id, "status">)`. Любое расширение этой surface требует отдельного review и stage approval.

Stage-2 runner MUST использовать system Git через `spawn` с argv array и `shell:false`; брать cwd только из immutable probe target/descriptor; фильтровать environment; устанавливать `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`; ограничивать stdout/stderr; поддерживать deadline/`AbortSignal`, TERM→KILL cleanup и structured redacted errors с repository/operation IDs. Arbitrary argv API запрещён.

Для автоматически найденных untrusted repositories status MUST neutralize repository-defined executable configuration. System/global config отключается, command-executing local key names читаются exact read-only query и defensive-validating parser, после чего каждый найденный key получает process-local empty `-c key=` override. Это не изменяет repository config.

## 8. Canonical file status и RepoStore

`RepositoryObservation` и `BranchState` находятся в domain. Backend возвращает observation без store generation, lifecycle, confidence или timestamps применения.

Единственный file-level source of truth внутри domain observation — immutable `FileStatusEntry[]`.

`FileStatusEntry` MUST сохранять:

- `path` и optional `originalPath`;
- `indexStatus`;
- `worktreeStatus`;
- untracked state;
- conflict stages;
- rename/copy kind и similarity;
- optional submodule state.

`staged`, `unstaged`, `deleted`, `renamed`, `untracked` и `conflicted` MUST быть derived projections. Их независимое mutation/persistence запрещено.

`RepoStore<Id>` MUST хранить domain observation и добавлять store-owned generation, lifecycle, confidence/staleness, application timestamp, current operation и repository-local errors. Backend MUST NOT создавать `StoredRepositorySnapshot`.

## 9. Trusted OperationPlanner, OperationQueue и cancellation

Нормативный pipeline:

```text
typed OperationIntent(repoId, operationId, kind, payload)
  -> trusted OperationPlanner
  -> exact effects lookup + canonical payload validation
  -> complete participant/family impact resolution
  -> immutable opaque ValidatedOperationPlan + identity/digests
  -> boundary authorization permit
  -> GitExecutionPolicy permit
  -> CrossContextOperationCoordinator acquires every participant/family queue
  -> runtime authority issues AuthorizedGitOperation for active lease
  -> backend OR authorized safety executor
```

- Caller MUST NOT быть source of truth для effects/impact.
- Caller MUST NOT быть source of truth для required repository/family locks; planner вычисляет их из participants, relation graph и ownership, затем включает в plan digest.
- `OPERATION_EFFECTS` MUST быть exact exhaustive map по `OperationPayloadByKind`.
- Planner MUST runtime-validate effects against central map и fail closed при mismatch, unknown/uncanonicalizable payload, unresolved remote ownership либо incomplete impact.
- Ни один operation kind не может иметь request-dependent safety semantics. Для такой разницы создаются отдельные kinds.
- `ValidatedOperationPlan`, boundary/execution permits, verified backup/destructive permit, participant lease и authorized envelope MUST иметь runtime provenance. Compile-time brands недостаточны.
- Каждый runtime authority instance MUST хранить provenance в закрытом registry (`WeakMap`/эквивалент), выдавать capability через непубличный construction token и предоставлять verifier. Capability от другого authority instance и structurally matching JS object MUST отклоняться.
- Trusted issuer MUST создавать capability без exported unsafe assertion/cast API. Consumers получают verifier, но не issuance authority.
- До issuance planner/authorities MUST создать defensive snapshot всех security-relevant nested collections. Caller-owned payload/scope/impact/required-lock arrays, execution-profile arrays, permit participant arrays и lease order MUST NOT оставаться mutable aliases. После issuance изменение исходных references MUST NOT менять plan/permit/lease semantics.

Каждый context MUST иметь отдельную FIFO `OperationQueue<Id>`.

- Same-repository operations MUST сериализоваться.
- Disjoint repositories MAY выполняться параллельно.
- Queue принимает только `ValidatedOperationPlan`; task metadata из него содержит repo ID, operation ID, kind, payload identity, orthogonal effects, complete participant impacts, origin, deadline и signal.
- `GitOperationExecutionCoordinator` является единственным gate от validated plan к backend. Он последовательно проверяет plan provenance, получает boundary permit, получает Git execution permit, вызывает multi-queue coordinator и только внутри active lease выдаёт authorized envelope.
- Queued cancellation MUST предотвращать запуск task.
- Running cancellation MUST пройти до process runner.
- Runner implementation в будущем MUST завершать process tree, очищать pipes/temp/askpass resources и освобождать queue в `finally`.
- Timeout/cancel MUST возвращать structured error.
- После отменённой mutation store MUST перейти в unknown confidence до authoritative refresh.
- Destructive, commit, continuation и push MUST NOT автоматически retry.

Retry policy MUST принимать `OperationEffects`, а не single classification.

`OperationEffects` MUST независимо представлять как минимум:

- `network`;
- `mutatesWorktree`;
- `mutatesIndex`;
- `mutatesGitConfig`;
- `mutatesGitMetadata`;
- `mutatesLocalRefs`;
- `mutatesRemoteRefs`;
- `destructive`.

Нормативные примеры: fetch = network + local refs/metadata; pull-ff-only/merge = network + local refs + index/worktree/metadata; pull-rebase имеет те же mutation effects плюс `destructive`; push = network + remote refs. Ни один effect не заменяет другой.

`abort-operation` консервативно имеет `mutatesLocalRefs=true`: abort sequencer может восстановить или переместить HEAD/branch refs.

## 10. RepositoryWatcher

Каждый ready context MUST иметь логически отдельный `RepositoryWatcher<Id>`. Shared OS watch handles MAY дедуплицироваться coordinator, но events MUST сохранять target IDs.

Watcher scope:

- worktree;
- resolved gitdir/commonDir metadata;
- disappearance/return;
- external changes от editors, OpenCode, Codex, npm/build и Git CLI.

`RepositoryWatchCoordinator` MUST обеспечивать keyed debounce, bounded storm handling, overflow recovery и generation-safe targeted invalidation.

- Event в disjoint Repo A MUST NOT запускать status Repo B.
- Submodule HEAD event MUST invalidating child и его superproject, но не unrelated contexts.
- Common-dir ref/config event MUST invalidating все contexts одной repository family; per-worktree HEAD/index event MUST оставаться context-local при отсутствии другой relation.
- Obsidian vault events MAY ускорять invalidation, но MUST NOT быть единственным correctness source.
- Watcher MUST NOT изменять `RepoStore` напрямую.

На этапе 1 существуют только watcher contracts.

## 11. RepositoryTrustPolicy и GitExecutionPolicy

Автоматически обнаруженный repository MUST начинать как `untrusted`.

`shell:false` и argv arrays недостаточны: Git может запускать внешний код через hooks/configuration. Trust, execution и retry decisions MUST принимать opaque validated plan с centrally derived complete `OperationEffects`; произвольный caller-supplied vector запрещён. Execution policy MUST учитывать как минимум:

- hooks и `core.hooksPath`;
- `core.fsmonitor`;
- `credential.helper`;
- `core.sshCommand` и SSH environment;
- `filter.*`;
- merge drivers;
- external diff/textconv;
- editor/pager и другие command-executing settings.

Untrusted repository:

- MAY выполнять только explicit hardened read-only allowlist;
- MUST NOT выполнять mutating или network operations;
- MUST NOT запускать repository-defined external code;
- MUST возвращать structured trust-required decision.

Trusted repository MAY использовать обычные hooks, SSH и credential helpers, но всё равно подчиняется timeout, redaction, boundary и destructive policies.

Trust MUST persist by `RepositoryId` и MUST NOT наследоваться nested/submodule contexts.

Allowed `GitExecutionPolicy` decision MUST содержать runtime-verifiable permit для matching plan identity/digest. Само значение `allowed=true` не разрешает backend execution: permit становится обязательной частью `AuthorizedGitOperation`.

`GitExecutionProfile.disabledSurfaces` и любые будущие nested allow/deny collections MUST defensive-copy и freeze при issuance; shallow freeze caller-owned profile object недостаточен.

## 12. SafetyBackupService

Destructive operation MUST быть доступна application/UI только через `RepositorySafetyFacade<Id>`.

Facade pipeline для одного immutable `ValidatedOperationPlan`:

1. Получить opaque boundary permit для full participant/family impact set и matching plan identity.
2. Проверить trust/execution policy.
3. Создать snapshot вне target repository.
4. Проверить manifest, hashes и required ref/index data.
5. Получить active participant queue lease и `AuthorizedGitOperation` через тот же execution coordinator.
6. Только после verified backup и authorized envelope разрешить destructive executor.
7. При partial failure остановить chain и вернуть structured error с backup reference.

Backup failure MUST приводить к нулю destructive Git process invocations.

Public `GitBackend` не содержит discard/reset-hard/clean/force methods. Internal destructive executor MAY появиться только вместе с safety implementation и dependency rule, запрещающим обход facade.

Internal destructive executor/permit contract MUST находиться в `safety/internal/` и импортироваться только safety subsystem, не UI/application/core/public Git/infrastructure. `SafetyBackupRequest` MUST содержать сам validated plan и MUST NOT дублировать независимый impact/target. Verified backup и `VerifiedDestructivePermit` MUST иметь runtime provenance и связывать `repoId`, operation ID, kind, `planIdentity`, `planDigest`, `payloadDigest` и backup ID. Executor получает `AuthorizedGitOperation` + destructive permit и MUST fail closed до process invocation, если provenance, active lease или любое identity/digest поле не совпадает. Backup target A не может авторизовать payload/target B.

Force push по умолчанию запрещён. Будущая `ForceUpdateRemoteRef` MUST получить фактический remote OID, сохранить его в local protected ref, проверить equality и использовать exact `--force-with-lease=<ref>:<expectedOid>`.

## 13. RemoteService

`RemoteService` — application port поверх того же context-bound `GitBackend`.

Он MUST поддерживать:

- list remotes;
- fetch/push URLs;
- add/set/remove remote;
- read/set upstream;
- explicit fetch/pull/push requests.

RemoteService MUST NOT:

- предполагать `origin`, `main` или `master`;
- требовать GitHub API;
- принимать raw shell/Git command;
- обходить context queue, trust policy или backend.

Если local-path remote является другим зарегистрированным context и операция способна изменить его refs, она MUST стать explicit cross-context operation.

Remote effects нормативны: fetch мутирует local refs/metadata; pull-ff-only/merge также мутируют index/worktree; pull-rebase дополнительно является destructive history rewrite; push мутирует remote refs. Remote policy MUST NOT сворачивать их в единственный признак `network`.

## 14. UI, events и main.ts

- UI state MUST хранить explicit `repoId` через application-exported immutable value/read model.
- UI MUST использовать только application public controllers/facades/read models. Import `RepositoryContext`, любого `git/*`, `OperationQueue`, safety internals, mutable `RepoStore` или watcher contracts запрещён независимо от type-only/runtime form.
- Конкретная public boundary — `src/application/public/**`; будущий `src/application/internal/**` автоматически запрещён UI.
- Repository event MUST содержать `repoId`; topology event MAY дополнительно содержать related IDs.
- Dashboard является read-only projection многих stores, а не global store.
- Bulk operation MUST разлагаться на per-context tasks и возвращать all-settled report.
- Один repository error MUST NOT блокировать остальные contexts.
- `main.ts` MUST оставаться composition root и не содержать Git/domain orchestration.

## 15. Автоматические архитектурные проверки

Baseline CI MUST выполнять:

- TypeScript typecheck source contracts;
- отдельный typecheck negative type fixtures;
- ESLint;
- dependency-cruiser boundary/cycle checks;
- AST-based architecture tests;
- unit tests для operation effects/invariant fixtures;
- production build.

Проверки MUST запрещать:

- UI import concrete `DesktopGitBackend`/Git infrastructure;
- любой UI import `core`, `git`, `operations`, `safety`, `state` или `watching`;
- `child_process`/`simple-git` вне `git/infrastructure`;
- Git execution из UI;
- top-level singleton `gitManager`, `basePath`, `repoStore` или global `RepoStore` instance;
- caller intents без `repoId` либо с caller-supplied effects/impact; validated plans без opaque identity, exact effects, canonical payload/full-plan digests или complete participant impact set;
- backend method, принимающий bare `ValidatedOperationPlan`, либо application/internal bypass без `AuthorizedGitOperation`;
- backend verifier без обязательных expected `repositoryId` и exact `OperationKind`;
- lease issuance из caller-supplied family set либо verification без exact plan-required repository/family equality;
- shallow authorization evidence, сохраняющий caller-owned mutable nested references;
- runtime capability, основанную только на TypeScript brand без issuer-specific provenance verifier;
- cross-context execution без deterministic all-participant/family lease и `finally` release contract;
- backend request fields `cwd`, `gitDir`, `workTree` и retarget flags;
- любое изменение exact reviewed full surface public `GitBackend`/`RepositoryProbeBackend`, включая property/extends/call/index/function-valued escape, без review/test update;
- обход `RepositorySafetyFacade` из UI;
- import `safety/internal` из любого layer вне `safety/`;
- `GitBackend -> state/RepoStore` dependency;
- создание final backend/descriptor до успешного provisional probe;
- классификацию shared-common-dir contexts как disjoint;
- cycles и обратные layer dependencies;
- runtime Git implementation вне exact stage-scoped allowlist.

## 16. Stage gates

Этап 1 завершён и утверждён пользователем.

Этап 2 разрешён отдельным подтверждением пользователя. Он завершён только после unit/architecture/type/build checks и отдельного integration suite с real system Git, включая multi-repository isolation и linked-worktree family serialization.

Этап 3 MUST NOT начинаться без отдельного подтверждения пользователя. Stage/unstage/commit, любые branch/ref/config mutations, fetch/pull/push и полноценная Source Control UI до этого подтверждения запрещены.
