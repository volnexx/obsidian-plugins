# Git: исследование архитектуры multi-repository плагина для Obsidian

Дата исследования: 2026-08-21

Статус: этап 0 уточнён по архитектурному review; архитектура ещё не утверждена; реализация не начиналась.

Целевой каталог проекта: `<vault>/<configDir>/plugins/git`.

## 1. Резюме решения

Новый проект не должен быть форком одного из доноров и не должен быть механическим объединением codebase. Рекомендуемая модель — собственное доменное и application-ядро, один связанный с конкретным репозиторием `DesktopGitBackend`, независимый `RepoStore` и независимая `OperationQueue` в каждом `RepositoryContext`.

Главные решения:

- Основной desktop Git-движок — один собственный `DesktopGitBackend`, построенный на системном Git и безопасной передаче массива аргументов. Главный донор поведения и интеграции — Obsidian Git; разбор porcelain v2, log и ahead/behind адаптируется из Git History внутрь того же backend, а не становится вторым Git-сервисом.
- Состояние репозитория — отдельный `RepoStore` на каждый `RepositoryContext`, адаптированный из Git History.
- Реестр и обнаружение репозиториев пишутся самостоятельно. Submodule не является основной моделью.
- Source Control и Graph берутся по UX и структуре из Git History. Hunk engine и CodeMirror MergeView берутся прежде всего из Obsidian Git.
- Dashboard и изоляция результата массовых операций адаптируются из Agentic Git Sync, но без GitHub-centric sync pipeline, submodule-centric registry и AI recovery.
- Любая потенциально разрушительная операция проходит через собственный fail-closed `SafetyBackupService`. Его нужно реализовать до появления `discard`, а не после Source Control.
- Отношения между contexts моделируются явно как `disjoint`, `nested`, `submodule-of` и `superproject-of`. Изоляция означает не отсутствие любых наблюдаемых последствий, а отсутствие немоделированных изменений чужих файлов или refs.
- Наблюдение за внешними изменениями выполняют отдельные `RepositoryWatcher` и `RepositoryWatchCoordinator`; Obsidian vault events остаются дополнительным сигналом, а не единственным источником invalidation.
- Автоматически обнаруженный repository первоначально считается `untrusted`. `RepositoryTrustPolicy` и `GitExecutionPolicy` учитывают hooks и command-executing Git configuration, а не только безопасную передачу argv.
- Remote management выделяется в `RemoteService` и никогда не предполагает имена `origin`, `main` или `master`.
- Runtime root — canonical absolute realpath, но persistent identity — UUID плюс portable locator. Перенос vault не должен сбрасывать per-repo settings.
- `FileStatusEntry` является единственным каноническим состоянием файла; staged/unstaged/renamed/deleted/conflicted — только derived projections.
- Queue и command runner имеют сквозные timeout/cancellation semantics и обязаны освобождать repository после зависшего child process.
- Конфликт определяется Git index и текущей Git-операцией, а не только наличием текстовых conflict markers.
- Mobile backend остаётся архитектурным портом. Первая поставка должна честно быть desktop-only; пустой или частично работающий `MobileGitBackend` не создаётся.

## 2. Проверенное состояние исходников

Исследование выполнено по исходному коду, тестам, default branch и доступным актуальным веткам, а не только по README.

| Проект | Проверенная ветка | Commit | Дата commit | Лицензия |
| --- | --- | --- | --- | --- |
| Obsidian Git | `master` | `e0598d9651618363b8c72e1f90955a6765c11ac4` | 2026-08-17 | MIT, Vinzent03 и Denis Olehov |
| Git History | `main` | `eaec276bd9f6ca3e16eceeb79b344b6bef535703` | 2026-08-21 | MIT, Chris Oguntolu |
| Agentic Git Sync | `main` | `2a82f02dbbdd118d21422b657b3230cf6dfdb20e` | 2026-08-13 | MIT, Jakob |
| Git File Explorer | `master` | `0a2b73c8537ecc75b56ecd0725e5736f4fbbe869` | 2026-05-05 | MIT, Mateus Molina |
| Easy Git | `main` | `d9546b18dded3c0e903ee6363d794187b61994c1` | 2026-08-21 | MIT, Saiki77 |
| CoNote Git | `main` | `3ac1a7a13dcf49ed3a2bcc7b034df3a33f6dd5a7` | 2026-07-22 | MIT, Maximilian Witte |
| GitFacil | `main` | `d6f4b26f0e4984bbf534c180ed7479063ba3b449` | 2026-08-06 | MIT, Alex Lazo |

У Git File Explorer дополнительно проверены ветки `dev`, `bugfixes`, `MateusMolina/issue5`, `optimized-changes-widget`, `feat/gitdiff-contextmenu`, `feat/enhanced-context-menu-with-commands` и `copilot/configurable-try-mechanism-git-sync`. Все они старше `master`; актуальный `master` включает более новые event bus, smart debouncing, widgets и external diff/view changes. У Obsidian Git остальные открытые heads на момент проверки являются Dependabot-ветками; архитектурной альтернативы `master` среди них нет. У остальных доноров опубликована одна основная ветка.

Ссылки на зафиксированные снимки:

- [Obsidian Git](https://github.com/Vinzent03/obsidian-git/tree/e0598d9651618363b8c72e1f90955a6765c11ac4)
- [Git History](https://github.com/chrisurf/obsidian-git-history/tree/eaec276bd9f6ca3e16eceeb79b344b6bef535703)
- [Agentic Git Sync](https://github.com/leweii/agentic-git-sync/tree/2a82f02dbbdd118d21422b657b3230cf6dfdb20e)
- [Git File Explorer](https://github.com/MateusMolina/obsidian-git-file-explorer/tree/0a2b73c8537ecc75b56ecd0725e5736f4fbbe869)
- [Easy Git](https://github.com/Saiki77/Easy-Git/tree/d9546b18dded3c0e903ee6363d794187b61994c1)
- [CoNote Git](https://github.com/Maximilianwte/Obsidian_CoNote_Git/tree/3ac1a7a13dcf49ed3a2bcc7b034df3a33f6dd5a7)
- [GitFacil](https://github.com/Alecwce/obsidian-git-facil/tree/d6f4b26f0e4984bbf534c180ed7479063ba3b449)

## 3. Текущее состояние vault и нового проекта

- Каталога `.obsidian/plugins/git` до этого исследования не существовало.
- В ходе этапа 0 создан только этот исследовательский документ. Исходный код, package metadata и manifest не создавались.
- Корень vault не является Git-репозиторием.
- Среди прямых папок `.obsidian/plugins/*` обнаружен один полноценный Git-репозиторий: `.obsidian/plugins/parsing`, ветка `main`, commit `ad8f4bef1c9afa3fbd3b13823c7b592179befa33`, рабочее дерево чистое, remote не настроен.
- `parsing` — отдельный пользовательский плагин, а не стартовая кодовая база нового Git-плагина. Из него разумно взять только совместимые build conventions после утверждения архитектуры; его `src/main.ts` не содержит Git-архитектуры для переноса.
- Реальный vault уже подтверждает основной сценарий: независимый репозиторий находится внутри `<vault>/.obsidian/plugins`, а не в корне vault.

## 4. Итоговое распределение подсистем между донорами

| Подсистема | Главный источник | Вторичные источники | Решение |
| --- | --- | --- | --- |
| Контракт Git backend | Obsidian Git `GitManager` | Git History `GitService` | Переписать контракт под immutable repo root и dependency injection |
| Desktop Git runtime | Obsidian Git `SimpleGit` | Git History `execFile`; Agentic `gitFactory` | Один `DesktopGitBackend`; simple-git и direct argv являются внутренними деталями одного backend |
| Status model и porcelain parser | Git History | Obsidian Git types | Адаптировать porcelain v2 `-z`; добавить branch headers и полную unmerged-модель |
| RepositoryRegistry | Собственная реализация | Agentic `Map<string, GitManager>` | Не переносить SubmoduleManager как registry |
| RepositoryDiscovery | Собственная реализация | Git History root check; Git File Explorer path object; Agentic `resolveGitDir` | Проверка реального root через Git, поддержка `.git` directory и gitfile |
| Repository relations и boundary policy | Собственная реализация | Git `show-superproject-working-tree`, gitlink/index metadata | Явный relation graph; preflight affected paths; cross-context operations только через coordinator |
| Repository identity/locators | Собственная реализация | Git File Explorer path-bound object | UUID отдельно от runtime realpath; vault-relative и external locator strategies |
| RepoStore | Git History `RepoStore` | Agentic per-repo progress | Один store на context; добавить generation, structured error и timestamps |
| OperationQueue | Собственная реализация | Obsidian Git `PromiseQueue`; CoNote `runExclusive` | Строгая per-repo FIFO, coalescing и cancellation; без ссылки на plugin singleton |
| Repository watching | Собственная реализация | Git File Explorer smart debouncing/event bus | Per-repo worktree + resolved Git metadata watchers; keyed debounce и storm recovery |
| Trust/execution policy | Собственная реализация | Obsidian Git environment/credential handling | Trusted/untrusted profiles; allowlisted safe reads; hooks/config execution surfaces controlled centrally |
| Remote management | Собственная реализация поверх единого backend | Obsidian Git remote API; Git History upstream parsing | `RemoteService` без GitHub API и без implicit `origin`/default branch assumptions |
| Dashboard | Agentic `SyncDashboard` | Git File Explorer markers | Полностью generic repository cards, не GitHub/submodule cards |
| Bulk operations | Agentic `syncAll` | Собственная orchestration | Ограниченный параллелизм между repo, `Promise.allSettled`, итоговый отчёт |
| Source Control | Git History `SourceControlView` | Obsidian Git Source Control | Адаптировать на `repoId` и application controller |
| Diff rendering | Obsidian Git `SplitDiffView` | Git History minimap/virtualization ideas | CodeMirror MergeView как база; не использовать самодельный tokenizer как источник корректности |
| Hunk engine | Obsidian Git `editor/signs` | Git History UI affordances | Перенести pure hunk/patch logic с тестами; все apply через единый backend |
| History/File History | Git History | Obsidian Git log types | Git History log batching и `--follow` |
| Graph | Git History `GraphView` и `graph-layout` | Нет | Адаптировать virtualization и layout per repo |
| Branch management | Git History branch model | Obsidian Git remote checkout/collision handling | Объединить внутри одного backend и одного BranchService |
| Conflict UX | Собственная Git-index модель | Agentic `ConflictModal` и `ConflictParser` | Взять UI flow, не marker scan и не AI |
| Automation | Obsidian Git `AutomaticsManager` | Agentic `SyncScheduler`; CoNote queues | Собственный coordinator с per-repo persisted schedule |
| Safety backup | Easy Git `backupVaultFile` | Agentic destructive tiers | Собственная расширенная snapshot service, fail-closed |
| External tools | Собственная реализация | Git History terminal; Git File Explorer terminal executor | `spawn`/`execFile`, `shell:false`, `cwd=context.rootPath` |
| Mobile | Obsidian Git `IsomorphicGit` | CoNote `dir`/`gitdir` | Только будущая реализация за тем же port; desktop metadata не выносить |
| Error recovery | Собственная детерминированная модель | Agentic error taxonomy/log redaction | Никакой AI-зависимости и никакого автоматического discard/reset |

## 5. Анализ доноров

### 5.1 Obsidian Git

Сильные стороны:

- Самый широкий и зрелый набор desktop Git-операций среди доноров.
- Реальная поддержка custom Git path, PATH additions, environment, platform differences, SSH askpass, progress и Git root resolution.
- Проверенная hunk-модель с pure-функциями, patch generation, no-newline handling и round-trip тестами через настоящий Git.
- Разделение desktop `SimpleGit` и mobile `IsomorphicGit` подтверждает жизнеспособность backend port.
- Automatics восстанавливает оставшееся время после restart и умеет отдельные интервалы commit/pull/push.

Конкретные файлы для адаптации:

- [`src/gitManager/gitManager.ts`](https://github.com/Vinzent03/obsidian-git/blob/e0598d9651618363b8c72e1f90955a6765c11ac4/src/gitManager/gitManager.ts) — перечень возможностей будущего `GitBackend`, tree projection и commit-message features.
- [`src/gitManager/simpleGit.ts`](https://github.com/Vinzent03/obsidian-git/blob/e0598d9651618363b8c72e1f90955a6765c11ac4/src/gitManager/simpleGit.ts) — Git runtime, environment, askpass, progress, platform handling, branch/log/diff operations.
- [`src/gitManager/isomorphicGit.ts`](https://github.com/Vinzent03/obsidian-git/blob/e0598d9651618363b8c72e1f90955a6765c11ac4/src/gitManager/isomorphicGit.ts) — будущая mobile capability matrix, не desktop implementation.
- `src/editor/signs/diff.ts`, `hunks.ts`, `hunkState.ts`, `hunkActions.ts` — основной кандидат на существенную адаптацию hunk subsystem.
- `tests/editor/signs/diff.test.ts`, `hunks.test.ts`, `patchRoundTrip.test.ts` — перенос тестовых идей обязателен вместе с hunk code.
- `src/ui/diff/splitDiffView.ts` — CodeMirror MergeView, stage/unstage/reset controls и editable worktree pane.
- `src/automaticsManager.ts` — persisted timestamps, independent timers, resume-after-restart.
- `src/promiseQueue.ts` — только идея продолжения очереди после reject.
- `src/commands.ts`, `src/statusBar.ts`, `src/types.ts` — command coverage, progress/status presentation и типы статусов.

Что переписать:

- Конструктор `GitManager(plugin)` заменить на `DesktopGitBackend(repositoryDescriptor, dependencies)`.
- Полностью убрать чтение `plugin.settings.basePath`, `plugin.gitManager`, `plugin.statusBar`, `plugin.localStorage` и `plugin.app` из backend.
- `absoluteRepoPath` сделать immutable после probe/factory creation; метода `updateBasePath` быть не должно.
- Progress и errors передавать callback/event sink с обязательным `repoId`.
- `applyPatch` не должен писать общий файл `patch` в каталоге плагина: patch передаётся Git через stdin или уникальный temp file с гарантированным cleanup.
- `PromiseQueue` переписать: ошибки возвращаются caller как structured result, а не отправляются глобальному `plugin.displayError`.
- Automatics переписать с per-repo settings/state и dispatch через queue конкретного context.

Что не переносить:

- `src/main.ts` как архитектурный центр: он содержит singleton `gitManager`, cached global status и слишком много orchestration/UI responsibility.
- `rawCommand(command: string)` с разбиением строки по пробелам.
- Reset sync mode и любые destructive branches без safety guard.
- Submodule update/push shell script из `SimpleGit.push`.
- Глобальные workspace events без `repoId`.
- Прямые casts `plugin.gitManager as SimpleGit` из Diff/Hunk UI.

### 5.2 Git History

Сильные стороны:

- `GitService(repoPath)` уже связывает Git service с абсолютным путём, хотя проект создаёт только один instance.
- Porcelain v2 с NUL delimiters корректнее для rename, пробелов, Unicode и untracked trees, чем обычный line parser.
- `RepoStore` хорошо отображает staged, working-tree, untracked, conflicts, branch, upstream, loading и busy; эти projections полезны для UI, но не должны стать независимыми каноническими collections нового проекта.
- Refresh coalescing, fingerprints и graph virtualization рассчитаны на реальную нагрузку.
- Graph/log делает batching stats, поддерживает root commits, merge commits, file history через `--follow` и не запускает процесс на каждую строку.
- Сильный набор unit и Obsidian E2E тестов.

Конкретные файлы для адаптации:

- [`src/git/git-service.ts`](https://github.com/chrisurf/obsidian-git-history/blob/eaec276bd9f6ca3e16eceeb79b344b6bef535703/src/git/git-service.ts) — porcelain v2 parser, path chunking, nested repo handling, log parser, ahead/behind, branches, file history и safe argv execution.
- [`src/store/repo-store.ts`](https://github.com/chrisurf/obsidian-git-history/blob/eaec276bd9f6ca3e16eceeb79b344b6bef535703/src/store/repo-store.ts) — основа независимого `RepoStore`.
- `src/store/commit-action.ts` — чистая state-to-action функция для primary button.
- `src/views/source-control-view.ts` — главный UX-донор Source Control.
- `src/views/graph-view.ts` и `src/utils/graph-layout.ts` — главный донор History/Graph.
- `src/views/diff-view.ts` — только идеи minimap, side-by-side/inline, chunked rendering.
- `src/terminal/session-list.ts`, `session-manager.ts`, `terminal-session.ts` — embedded terminal lifecycle; cwd нужно изменить с vault root на repo root.
- `tests/git-service.test.ts`, `graph-layout.test.ts`, `graph-view.test.ts`, `source-control-view.test.ts` и `test/specs/*` — источник regression scenarios.

Что переписать:

- `GitService` не остаётся параллельным backend. Нужные parsers/commands входят внутрь `DesktopGitBackend`.
- Queue из `GitService` не должна сериализовать только mutating methods: fetch, refresh и push одного repo не должны случайно пересекаться. Сериализация принадлежит `RepositoryContext.OperationQueue`.
- `RepoStore` получает `repoId`, canonical `FileStatusEntry[]`, derived projections, structured `lastError`, operation state, timestamps, generation и invalidation reason.
- Global file watcher из `main.ts`, обновляющий единственный store на любое событие, заменяется отдельными `RepositoryWatcher` и `RepositoryWatchCoordinator` с targeted resolver, Git metadata observation и keyed per-repo debounce.
- Views получают `RepositoryController` и explicit `repoId`, а не весь plugin с `plugin.git` и `plugin.store`.

Что не переносить:

- `discardAll()` с `checkout -- .` и `clean -fd` без backup.
- Direct `execFile("git", ["apply", ...])` из `DiffView`, обходящий backend и queue.
- Самодельный JS/CSS/JSON/Markdown tokenizer как основной долгосрочный syntax engine.
- `DiffView.buildPatch` как источник hunk correctness: у Obsidian Git hunk engine заметно лучше протестирован.
- Один global `git`, `store`, `terminals` в `main.ts`.

### 5.3 Agentic Git Sync

Сильные стороны:

- `SubmoduleManager.gitManagers: Map<string, GitManager>` показывает корректную идею независимого manager на repo ID.
- `syncAll()` использует `Promise.allSettled`, поэтому один failure не стирает результаты остальных.
- Dashboard хранит отдельный phase/error/conflict для каждой card и обновляет их независимо.
- Есть structured `GitConflictError`, progress events, secret redaction и полезные tests для gitfile/submodule cases.
- `resolveGitDir` корректно следует `.git` gitfile к реальному gitdir.

Конкретные файлы для идей и ограниченной адаптации:

- [`src/git/SubmoduleManager.ts`](https://github.com/leweii/agentic-git-sync/blob/2a82f02dbbdd118d21422b657b3230cf6dfdb20e/src/git/SubmoduleManager.ts) — `Map<id, manager>`, lazy creation и `Promise.allSettled` bulk result.
- [`src/ui/SyncDashboard.ts`](https://github.com/leweii/agentic-git-sync/blob/2a82f02dbbdd118d21422b657b3230cf6dfdb20e/src/ui/SyncDashboard.ts) — repository cards, incremental phase/error updates и isolated actions.
- `src/sync/SyncScheduler.ts` — blocked repo set, status/complete events и per-repo error isolation.
- `src/git/GitManager.ts` — structured progress, conflict errors, transient-network classification; не sync algorithm.
- `src/git/recoveryTools.ts` — `resolveGitDir` и explicit destructive tiers.
- `src/git/gitFactory.ts` — фильтрация command-executing environment variables и non-interactive behavior.
- `src/git/loggedGit.ts` и `src/observability/EventLog.ts` — repo-tagged diagnostics и secret redaction.
- `src/ui/ConflictModal.ts`, `src/sync/ConflictParser.ts`, `src/sync/ConflictRepoOps.ts` — UX resolution flow и pure marker parser как вспомогательный parser.
- `src/config/RepoConfig.ts` — идея разделения portable structure и local-only secrets/state.

Что не переносить:

- `SubmoduleManager` как registry и submodule lifecycle как обязательную модель.
- GitHub App/PAT/REST API как основу обычного Git remote.
- `_doSync()` pipeline, который автоматически commit-before-pull и push-after-merge.
- Recovery rules, автоматически выполняющие discard, checkout, reset или удаление блокирующих untracked files.
- AI `GitErrorAgent` и `GitReActAgent` в фундаменте.
- Marker scan как source of truth для Git conflict.
- Auto-take-theirs для пользовательского содержимого.
- Хранение credential tokens в Git `insteadOf` URL/config.

### 5.4 Git File Explorer

Сильные стороны:

- `GitRepository(repoAbsPath)` рассматривает repository как объект, связанный с абсолютным путём.
- Widget factory создаёт отдельные виджеты на найденный folder/repository.
- Event bus и keyed smart debounce уменьшают лишние обновления.
- `NavColorUpdater` и `ChangesGitWidget` дают понятные dirty markers.

Конкретные файлы для идей:

- [`src/git/gitRepository.ts`](https://github.com/MateusMolina/obsidian-git-file-explorer/blob/0a2b73c8537ecc75b56ecd0725e5736f4fbbe869/src/git/gitRepository.ts) — path-bound object.
- `src/widgets/widgetManager.ts`, `gitWidgetFactory.ts`, `changesGitWidget.ts` — discovery-to-widget flow.
- `src/widgets/utils/eventBus.ts`, `smartDebouncer.ts` — keyed updates.
- `src/widgets/navColorUpdater.ts` — визуальные markers.

Что не переносить:

- `GitRepository` как второй backend.
- `isGitRepo = existsSync(path/.git)`: он не проверяет root и хотя принимает gitfile фактом существования, не отличает вложенность/ancestor repository.
- `stageAll("./*")`, hardcoded `origin`, assumption remote branch equals local branch.
- Terminal command strings и shell-based difftool запуск.
- Генерацию множества per-path CSS rules как основной scalable marker mechanism.

### 5.5 Easy Git

Сильные стороны:

- `backupVaultFile` явно документирует fail-closed правило: backup write failure прерывает sync.
- Backup выполняется перед overwrite/delete для каждой затрагиваемой local file.
- Есть retention, preview/prune model и безопасное удаление через Obsidian trash.
- Engine отказывается считать исчезнувшую mapping folder массовым удалением.

Конкретные файлы для принципов:

- [`src/sync/engine.ts`](https://github.com/Saiki77/Easy-Git/blob/d9546b18dded3c0e903ee6363d794187b61994c1/src/sync/engine.ts) — `backupVaultFile`, backup-before-apply и abort-on-failure.
- `src/sync/classifier.ts` — explicit destructive action classification как идея, не Git logic.
- `src/sync/reconcile.ts` и `src/ui/prune-modal.ts` — preview/explicit prune и trash behavior.

Что переписать:

- Backup storage вынести из `.easy-git-backup` внутри vault в `BackupStorageProvider`, физически находящийся вне любого управляемого plugin repository.
- File copy дополнить manifest, SHA-256 verification, modes/symlinks, index patch, refs/bundle и atomic finalize.
- Safety plan строится из Git preflight конкретной destructive operation, а не из file sync classifier.

Что не переносить:

- GitHub file synchronization engine, last-sync classifier и mapping reconciliation.
- Directional sync semantics, которые не соответствуют настоящему Git index/worktree.
- Backup location внутри синхронизируемого vault как единственный вариант.

### 5.6 CoNote Git

Сильные стороны:

- `SyncEngine.runExclusive(mapping.id)` — компактный и правильный пример per-repository serialization.
- Core не импортирует Obsidian и использует backend interface.
- `GitBackend.paths()` ясно разделяет `dir` и `gitdir`.

Конкретные файлы для идей:

- [`src/core/sync.ts`](https://github.com/Maximilianwte/Obsidian_CoNote_Git/blob/3ac1a7a13dcf49ed3a2bcc7b034df3a33f6dd5a7/src/core/sync.ts) — per-mapping queue и independent event mapping ID.
- `src/core/gitBackend.ts` — future mobile `dir`/`gitdir` capability reference.
- `src/core/types.ts`, `fileStore.ts` — UI-free core contracts.

Что не переносить:

- Отдельное git metadata storage для desktop mode.
- Force checkout после merge.
- Conflict detection только сканированием markers.
- GitHub PAT auth model и sync-specific automatic commit/push.

### 5.7 GitFacil

Сильная сторона — минимальный `execFile("git", args, {cwd})`, демонстрирующий, что shell concatenation не нужна.

Конкретный справочный файл:

- [`gitHelper.ts`](https://github.com/Alecwce/obsidian-git-facil/blob/d6f4b26f0e4984bbf534c180ed7479063ba3b449/gitHelper.ts) — простой argv execution.

Что не переносить:

- Обычный line-based porcelain parser без `-z`.
- `isGitRepo` без проверки, что candidate является root, а не просто находится внутри ancestor repo.
- Hardcoded `origin/main`/`origin/master`.
- `syncAndAlignWithRemote` через soft reset.
- Vault-wide singleton architecture.

## 6. Сравнение конфликтующих реализаций

### 6.1 Git execution

Obsidian Git наиболее зрелый по platform/runtime/credentials/progress. Git History проще и чище передаёт argv и лучше разбирает status/log. Решение: не держать оба сервиса. Один `DesktopGitBackend` использует runtime/configuration patterns Obsidian Git и переносит внутрь себя лучшие parsers/commands Git History.

### 6.2 Status

Git History `status --porcelain=v2 -z --untracked-files=all` лучше обычного status projection для Unicode, rename, dual index/worktree state и nested repos. Новый backend должен расширить его branch headers (`# branch.head`, `# branch.upstream`, `# branch.ab`) и получать основной snapshot одной командой.

### 6.3 Diff и hunks

Git History имеет привлекательный minimap и chunked rendering, но stage/revert hunk выполняются прямым `execFile` из view, patch builder слабо протестирован, а custom tokenizer станет отдельным maintenance burden. Obsidian Git использует CodeMirror MergeView, pure hunk transformations и реальные patch round-trip tests. Поэтому source of truth — Obsidian Git hunk engine; Git History даёт только UX/performance идеи.

### 6.4 Graph/history

Git History существенно сильнее: batch stats, merge/root handling, file rename history, virtualization и отдельные tests. Он становится главным донором. Obsidian Git history UI не переносится параллельно.

### 6.5 Automation

Obsidian Git лучше восстанавливает время следующей операции; Agentic scheduler лучше изолирует repo errors; CoNote лучше демонстрирует per-ID queue. Новый coordinator объединяет эти свойства, но не их sync pipelines.

### 6.6 Safety/recovery

Easy Git правильно прекращает операцию при backup failure. Agentic Git Sync имеет полезную explicit classification, но считает некоторые reset/force operations recoverable через reflog и автоматически отбрасывает blocking files. Для этого проекта это неприемлемо. Источник истины — собственная allowlisted policy с обязательным verified backup и user intent.

### 6.7 Repository watching

Git File Explorer полезен как источник keyed/smart debounce и событийной модели, но ни один донор не даёт достаточной гарантии для внешних изменений worktree и Git metadata в десятках независимых repositories. Источник истины — собственные `RepositoryWatcher` и `RepositoryWatchCoordinator`, наблюдающие resolved worktree, gitdir и common dir. Obsidian vault events используются только как дополнительный low-latency hint.

### 6.8 Trust и выполнение внешнего кода Git

Ни один донор не моделирует repository trust достаточно полно. `shell:false` защищает от shell interpolation, но Git сам может запустить hooks, credential helpers, SSH commands, filters, merge drivers, diff/textconv tools и fsmonitor. Поэтому источник истины — собственные `RepositoryTrustPolicy` и `GitExecutionPolicy`; runtime/credential patterns Obsidian Git применяются только после policy authorization.

### 6.9 Remote management

Remote-функции Obsidian Git дают полезную ширину API, а Git History хорошо читает upstream/ahead/behind, но application semantics нужно написать самостоятельно. Один `RemoteService` работает через тот же context-bound backend, принимает явные remote/ref arguments и не зависит от GitHub API.

## 7. Окончательная архитектура

### 7.1 Dependency direction

```text
Obsidian UI / Commands / Integrations
                 |
                 v
Application services and controllers
                 |
                 v
Domain: RepositoryContext, IDs, snapshots, operations, events
                 ^
                 |
Infrastructure: DesktopGitBackend, filesystem, watchers, backup storage

main.ts = composition root only
```

Правила зависимостей:

- `domain` не импортирует Obsidian, simple-git, Node fs или UI.
- `application` зависит от domain ports, но не от concrete backend.
- `ui` не вызывает Git и child processes напрямую.
- `infrastructure/git` — единственное место, где разрешён запуск `git`.
- Cross-context mutation разрешается только через application-level `CrossContextOperationCoordinator`; отдельный backend по-прежнему bound к одному context.
- Trust и execution policy применяются до запуска любого Git process, включая read-only commands.
- `integrations/external-tools` может запускать внешние приложения, но не выполняет Git-команды.
- `main.ts` только загружает settings, создаёт services, регистрирует views/commands и управляет lifecycle.

### 7.2 Предлагаемая структура

```text
src/
  domain/
    RepositoryId.ts
    RepositoryDescriptor.ts
    RepositoryLocator.ts
    RepositoryRelation.ts
    RepositorySnapshot.ts
    FileStatusEntry.ts
    RepositoryError.ts
    GitTypes.ts
    OperationTypes.ts
    paths.ts

  core/
    RepositoryContext.ts
    RepositoryContextFactory.ts
    RepositoryRegistry.ts
    RepositoryDiscovery.ts
    ActiveRepositoryResolver.ts
    RepositoryRelationGraph.ts
    CrossRepositoryBoundaryPolicy.ts
    RepositoryEventBus.ts

  application/
    RepositoryController.ts
    RepositoryOperations.ts
    RefreshCoordinator.ts
    CrossContextOperationCoordinator.ts
    BulkOperationService.ts
    BranchService.ts
    RemoteService.ts
    ConflictService.ts
    HunkService.ts

  git/
    GitBackend.ts
    GitBackendFactory.ts
    DesktopGitBackend.ts
    GitCommandRunner.ts
    GitEnvironment.ts
    GitParsers.ts
    CredentialBroker.ts
    RepositoryTrustPolicy.ts
    GitExecutionPolicy.ts
    GitTimeoutPolicy.ts

  watching/
    RepositoryWatcher.ts
    RepositoryWatchCoordinator.ts
    FileWatchAdapter.ts

  state/
    RepoStore.ts
    DashboardProjection.ts

  operations/
    OperationQueue.ts
    OperationGuard.ts
    OperationReport.ts
    AffectedPathPlan.ts

  safety/
    SafetyBackupService.ts
    BackupStorageProvider.ts
    BackupManifest.ts
    DestructiveOperationPolicy.ts

  automation/
    AutomationCoordinator.ts
    RepositorySchedule.ts

  ui/
    dashboard/
    source-control/
    diff/
    graph/
    history/
    branches/
    conflicts/
    common/

  editor/
    hunks/
    signs/

  integrations/
    ExternalToolsService.ts
    EmbeddedTerminalService.ts

  settings/
    Settings.ts
    SettingsRepository.ts
    SettingsTab.ts

  main.ts
```

Добавлен слой `application`, отсутствующий в первоначальном примере. Он нужен, чтобы UI не получил прямую ссылку на backend и не смог обойти queue, boundary policy, trust policy, backup и structured error handling. `watching/` — отдельная infrastructure subsystem: она сообщает invalidations, но не выполняет Git и не изменяет store напрямую.

### 7.3 RepositoryRegistry

`RepositoryRegistry` — единственный владелец зарегистрированных contexts:

```ts
class RepositoryRegistry {
  private readonly contexts = new Map<RepositoryId, RepositoryContext>();
  private readonly pathIndex: RepositoryPathIndex;

  get(id: RepositoryId): RepositoryContext | undefined;
  getRequired(id: RepositoryId): RepositoryContext;
  list(): readonly RepositoryContext[];
  rediscover(reason: DiscoveryReason): Promise<DiscoveryReport>;
}
```

Registry отвечает только за lifecycle, indexing и events. Он не выполняет status, fetch, commit или другие Git-команды.

Удалённый во время работы repository сначала переходит в `missing`; новые операции отклоняются structured error, текущая операция получает failure/cancellation, context удаляется только после безопасного завершения lifecycle. При повторном появлении locator используется сохранённый ID, если identity mapping однозначен. Registry публикует lifecycle events в watch coordinator и relation graph, но не владеет их логикой.

### 7.4 RepositoryContext

```ts
class RepositoryContext {
  readonly id: RepositoryId;
  readonly descriptor: RepositoryDescriptor;
  readonly store: RepoStore;
  readonly queue: OperationQueue;
  readonly metadata: RepositoryMetadata;

  // Видимы только application services, не UI.
  readonly backend: GitBackend;
  readonly safety: RepositorySafetyFacade;
}
```

`descriptor.runtimeRoot` — immutable canonical absolute realpath на время жизни context. Перемещение repository создаёт новый descriptor/context lifecycle, а не изменяет cwd работающего backend. Persistent locator и UUID при этом остаются теми же, если binding разрешён однозначно.

Context имеет lifecycle `probing | ready | missing | disposing | disposed`. Discovery создаёт provisional context с ID до `rev-parse`, поэтому даже discovery Git probe принадлежит конкретному context. Невалидный candidate не регистрируется и сразу dispose.

### 7.5 Runtime path и persistent repository identity

Runtime addressing и persistent identity являются разными сущностями:

```ts
type RepositoryLocator =
  | { kind: "vault-relative"; relativePath: VaultRelativePath }
  | { kind: "external"; locatorId: string; lastKnownAbsolutePath: string }
  | { kind: "submodule"; superprojectId: RepositoryId; relativePath: RepoRelativePath };

interface RepositoryIdentityBinding {
  repositoryId: RepositoryId; // случайный стабильный UUID
  locator: RepositoryLocator;
}

interface RepositoryRuntimeDescriptor {
  repositoryId: RepositoryId;
  runtimeRoot: CanonicalAbsoluteRealpath;
  gitDir: CanonicalAbsoluteRealpath;
  commonDir: CanonicalAbsoluteRealpath;
}
```

- Для repository внутри vault persistent locator хранит нормализованный vault-relative path, например `.obsidian/plugins/parsing`. При переносе `/home/user1/vault` в `/home/user2/vault` новый runtime root вычисляется от текущего vault root, а UUID и per-repo settings сохраняются.
- Для внешнего repository используется отдельный explicit locator record с собственным `locatorId`, last-known path и процедурой relink. Absolute path является только runtime hint, не identity.
- Для submodule допускается locator относительно UUID superproject, если это устойчивее vault-relative path.
- Remote URL, inode/file ID и absolute path не являются самостоятельным persistent identity: URL не уникален для clone, inode нестабилен при копировании, absolute path меняется при переносе.
- Если один locator разрешается в несколько roots или root занят другим UUID, система не угадывает identity, а возвращает `RepositoryIdentityAmbiguousError` и просит явный relink.

### 7.6 RepositoryRelationGraph и cross-repository boundary policy

`RepositoryRelationGraph` хранит явные направленные отношения между contexts:

```ts
type RepositoryRelation =
  | { kind: "disjoint"; left: RepositoryId; right: RepositoryId }
  | { kind: "nested"; parent: RepositoryId; child: RepositoryId }
  | { kind: "submodule-of"; child: RepositoryId; superproject: RepositoryId; path: RepoRelativePath }
  | { kind: "superproject-of"; superproject: RepositoryId; submodule: RepositoryId; path: RepoRelativePath };
```

- `disjoint`: canonical worktree roots не содержат друг друга и Git не сообщает submodule relation.
- `nested`: root child находится внутри worktree parent, но parent index не содержит соответствующий gitlink mode `160000` и Git не подтверждает superproject relation.
- `submodule-of` и обратное `superproject-of`: подтверждаются сочетанием `--show-superproject-working-tree`, resolved gitdir/commonDir, `.gitmodules` и gitlink entry в index. Одного path containment недостаточно.
- Для `nested` relation дополнительно строится path-ownership projection: какие child paths одновременно присутствуют в parent index, игнорируются parent или видны ему как opaque untracked boundary. Простого longest-root matching недостаточно для mutation safety.
- Git metadata ownership определяется resolved gitdir/ref namespace, а не только физическим containment. Например, `.git/modules/<child>` физически находится под superproject `.git`, но семантически принадлежит child submodule context.
- Relation graph пересчитывается при discovery, disappearance/return, изменении `.gitmodules` и relevant index metadata.

Перед каждой mutating или destructive operation `CrossRepositoryBoundaryPolicy` строит `AffectedPathPlan` и `AffectedRefPlan`. План учитывает command semantics, pathspec, dry-run/probe output, известные nested roots, gitlinks, worktree root, gitdir/commonDir и возможные recursive submodule effects.

Policy:

- Операция блокируется до запуска Git, если она может изменить файлы или refs другого context и для этого нет явно поддержанного relation-aware operation.
- Broad operations (`checkout`, `reset`, `clean`, recursive submodule update, stage/discard all) не считаются безопасными только потому, что process cwd принадлежит parent. Если affected set нельзя надёжно ограничить, операция fail-closed.
- Для обычного `nested` parent operation обязана исключить child boundary доказуемым pathspec/plan либо быть отклонена. Наличие child внутри parent не даёт parent права менять child files или refs.
- Child nested operation разрешена как single-context только если affected paths не принадлежат также parent index/operation scope. При tracked overlap она блокируется либо становится explicit cross-context operation с parent participant и точным plan.
- Изменение HEAD/worktree submodule через child context является допустимой локальной operation child. Наблюдаемое изменение gitlink status superproject — ожидаемое следствие relation: status superproject invalidates и refreshes, но его index/ref не изменяется автоматически.
- Stage нового gitlink OID, recursive checkout/update submodules или другая операция, реально затрагивающая оба contexts, оформляется как explicit cross-context operation с primary context, participant IDs, relation kind и полным affected plan.
- `CrossContextOperationCoordinator` получает queues всех participants в детерминированном порядке по `RepositoryId`, повторно проверяет relation/preconditions, применяет safety/trust policy к каждому participant и освобождает все queues в `finally`. Это предотвращает deadlock и скрытые side effects.
- Если remote URL разрешается в local filesystem path зарегистрированного context, операция, способная записать refs target context (прежде всего push/receive), также считается cross-context operation. Read-only fetch из такого target не получает право изменять его refs. Неизвестный network remote не превращается в `RepositoryContext`, но остаётся под network/trust/lease policy.

### 7.7 Два инварианта repository isolation

Инвариант принадлежности:

> Любая Git-операция однозначно принадлежит одному `RepositoryContext`.

Для обычной операции это единственный context. Для explicit cross-context operation существует ровно один initiating/primary context и явный конечный набор participant contexts; операция не становится context-free.

Инвариант границы:

> Ни одна mutating Git-операция не может изменить файлы или refs другого `RepositoryContext` без явно смоделированной cross-context relation/operation.

Он обеспечивается структурно:

- Backend создаётся только фабрикой context и навсегда привязан к одному immutable root.
- Методы backend не принимают `cwd`, `basePath`, `repoPath`, `gitDir` или `workTree` от caller.
- Любая application operation начинается с `repoId` и разрешает его через `registry.getRequired(repoId)`.
- Views хранят `repoId` в view state; active repository является выбором UI, а не глобальным Git state.
- Hunk, branch, conflict, history, terminal и external-tool actions всегда несут `repoId`.
- Любое repository event содержит `repoId`; event без repo target не может менять `RepoStore`.
- UI не имеет доступа к backend; только `RepositoryController` может поставить task в context queue.
- `GitCommandRunner` недоступен за пределами `git/` и запрещает retargeting arguments `-C`, `--git-dir`, `--work-tree` для обычных operations.
- File arguments имеют branded type `RepoRelativePath`; absolute path, NUL и выход через `..` отклоняются до Git.
- Bulk operation сначала раскладывается на независимые `(repoId, operation)` tasks, а затем вызывает queue каждого context.
- Любая mutation до queue execution получает relation-aware affected path/ref plan; runtime preconditions повторно проверяются непосредственно перед child process.
- ESLint/module-boundary test запрещает `child_process`, `simple-git` и импорт `DesktopGitBackend` из UI.
- Byte-for-byte неизменность sentinel repository B проверяется для `disjoint` repositories. Для `nested` и submodule relations tests проверяют только разрешённые relation effects и запрещают все остальные изменения.

Допустимые process-wide Git вызовы ограничены `git --version` и runtime capability detection; они не читают и не изменяют repository.

### 7.8 GitBackend

Backend contract разделён по capability groups, но реализован одним объектом:

```ts
interface GitBackend {
  readonly repositoryId: RepositoryId;
  readonly capabilities: GitCapabilities;

  probe(): Promise<RepositoryProbe>;
  status(): Promise<RepositoryStatusSnapshot>;
  log(query: LogQuery): Promise<readonly CommitInfo[]>;
  diff(query: DiffQuery): Promise<DiffResult>;
  showFile(query: ShowFileQuery): Promise<Uint8Array>;

  stage(paths: readonly RepoRelativePath[]): Promise<void>;
  unstage(paths: readonly RepoRelativePath[]): Promise<void>;
  applyIndexPatch(patch: Uint8Array, mode: PatchMode): Promise<void>;
  commit(request: CommitRequest): Promise<CommitResult>;

  fetch(request: FetchRequest): Promise<FetchResult>;
  pull(request: PullRequest): Promise<PullResult>;
  push(request: PushRequest): Promise<PushResult>;

  remotes(): Promise<readonly RemoteInfo[]>;
  getRemoteUrl(remote: RemoteName, kind: "fetch" | "push"): Promise<string | null>;
  addRemote(remote: RemoteName, url: RemoteUrl): Promise<void>;
  setRemoteUrl(remote: RemoteName, url: RemoteUrl, kind: "fetch" | "push"): Promise<void>;
  removeRemote(remote: RemoteName): Promise<void>;
  readUpstream(localBranch: LocalBranchName): Promise<UpstreamInfo | null>;
  setUpstream(localBranch: LocalBranchName, upstream: UpstreamTarget): Promise<void>;

  branches(): Promise<BranchSnapshot>;
  checkout(request: CheckoutRequest): Promise<void>;
  createBranch(request: CreateBranchRequest): Promise<void>;
  deleteBranch(request: DeleteBranchRequest): Promise<void>;

  conflictState(): Promise<ConflictState>;
  readIndexStage(path: RepoRelativePath, stage: 1 | 2 | 3): Promise<Uint8Array | null>;
  stageResolved(path: RepoRelativePath): Promise<void>;
  continueOperation(kind: SequencerOperation): Promise<void>;
  abortOperation(kind: SequencerOperation): Promise<void>;
}
```

Каждый async method фактически получает обязательный `GitExecutionContext { operationId, signal, deadlineAt, trustProfile }`; он опущен в сокращённой сигнатуре выше только ради читаемости. Backend method без execution context не экспортируется.

`init` и `clone` выполняются provisional `RepositoryContext` с заранее выданным ID и target root; после успешного probe context переводится в `ready`. Это сохраняет инвариант и не требует context-free Git service.

### 7.9 DesktopGitBackend, trust и command runner

- System Git — единственный desktop engine.
- `simple-git` допустим как transport/helper внутри backend, но весь Git surface контролируется backend.
- Для porcelain/log/apply через stdin допустим `execFile`/`spawn` с массивом аргументов. Это не второй backend.
- `shell` всегда `false`.
- Environment строится allowlist/filtered copy; command-executing variables, неожиданные `GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_*`, editor/pager/diff/filter hooks не принимаются из пользовательских settings.
- `LC_ALL=C` используется только для команд, где error classification зависит от текста; по возможности classification опирается на exit code и state probe.
- `GIT_TERMINAL_PROMPT=0` предотвращает зависание background operation. Credential broker/askpass показывает scoped prompt с repository name и remote host.
- Secrets redacted до записи error/log/store.
- Git binary path и PATH additions являются runtime dependencies, а не полями repository state.
- Progress event имеет `repoId`, `operationId`, phase и optional numeric progress.

Безопасный argv и `shell:false` не означают, что command безопасен: Git умеет самостоятельно запускать внешний код. `RepositoryTrustPolicy` хранит trust decision по persistent `RepositoryId`, а не по path или remote URL:

```ts
type RepositoryTrust = "untrusted" | "trusted";

interface GitExecutionPolicy {
  authorize(context: RepositoryContext, operation: GitOperationPlan): PolicyDecision;
  buildProfile(context: RepositoryContext, operation: GitOperationPlan): GitExecutionProfile;
}
```

- Автоматически найденный repository получает `untrusted`. Trust выдаётся пользователем явно, persist по UUID, может быть отозван и повторно подтверждается при ambiguous relink/identity conflict.
- Для `untrusted` разрешён минимальный allowlist read-only probes, не затрагивающих network и worktree/index/refs: capability/version, `rev-parse`, ограниченный `status`, безопасное чтение refs/config metadata. Diff/log допускаются только в профиле, явно отключающем external diff/textconv и другие execution hooks.
- Untrusted profile отключает или нейтрализует как минимум repository hooks и `core.hooksPath`, `core.fsmonitor`, credential helpers, `core.sshCommand`, `GIT_SSH*`, `filter.*`, merge drivers, `diff.external`, `diff.*.command`, `diff.*.textconv`, pager/editor и другие найденные command-executing config. Команда, безопасность которой нельзя доказать allowlist-профилем, отклоняется.
- Mutating commands и network operations для `untrusted` заблокированы. UI показывает structured `RepositoryTrustRequiredError` и обнаруженные execution surfaces, но не запускает их «для проверки».
- Для `trusted` разрешены нормальные Git hooks, SSH, credential helpers, filters/merge drivers в тех операциях, где это ожидаемо. Это сохраняет обычную разработку, но authorization, timeout, redaction и audit metadata остаются обязательными.
- Raw Git aliases/произвольные subcommands не входят в public API. Config читается с origin/scope metadata, чтобы UI мог объяснить, откуда пришёл `core.hooksPath`, helper или driver.
- Trust не заменяет destructive policy: trusted repository всё равно требует affected plan, backup и confirmation для разрушительной операции.

### 7.10 Canonical file status и RepoStore

Primary refresh использует одну команду `git status --porcelain=v2 -z --branch --untracked-files=all`, которая даёт branch, upstream, ahead/behind и index/worktree entries. Дополнительные процессы запускаются только для отсутствующих capability/state.

Канонический file-level source of truth — одна запись на logical path/change:

```ts
interface FileStatusEntry {
  path: RepoRelativePath;
  originalPath?: RepoRelativePath;
  indexStatus: GitIndexStatus;
  worktreeStatus: GitWorktreeStatus;
  untracked: boolean;
  conflictStages?: {
    base?: IndexStageMetadata;
    ours?: IndexStageMetadata;
    theirs?: IndexStageMetadata;
  };
  changeKind: "ordinary" | "rename" | "copy" | "unmerged" | "untracked";
  similarity?: number;
  submoduleState?: SubmoduleStatus;
}
```

Porcelain v2 record types `1`, `2`, `u` и `?` преобразуются в `FileStatusEntry` без потери dual index/worktree state, rename/copy origin, unmerged stages и submodule flags. Один файл может одновременно иметь staged и unstaged changes; поэтому независимые mutable collections `staged`, `unstaged`, `renamed`, `deleted`, `conflicted` запрещены.

`RepoStore` хранит:

- `repositoryId` и monotonically increasing `generation`;
- lifecycle/availability;
- branch, detached HEAD, upstream, ahead, behind, diverged;
- canonical immutable `files: readonly FileStatusEntry[]`;
- merge/rebase/cherry-pick/revert state;
- current operation и progress;
- loading/busy отдельно;
- `lastRefreshAt`, `lastFetchAt`, `lastPullAt`, `lastPushAt`, `lastCommitAt`;
- structured `lastError` и bounded error history;
- lazy caches для branches, log, graph и diffs.

`staged`, `unstaged`, `untracked`, `renamed`, `deleted` и `conflicted` являются memoized derived projections одного `files` snapshot для UI. Их нельзя независимо обновить или persist. Fingerprint строится из canonical entries и branch/operation state.

Refresh coalescing:

- Одновременно разрешён один queued refresh на repository.
- Повторный invalidation выставляет dirty flag и приводит максимум к одному дополнительному refresh.
- Result содержит generation/request ID; устаревший result не применяется.
- Fingerprint предотвращает лишние UI events.
- Watch invalidation обновляет только target context и только relation-dependent contexts, для которых доказано observable изменение.

### 7.11 OperationQueue: timeout и cancellation

Каждый context имеет отдельную FIFO queue. Все repository commands, включая reads, проходят через неё, поэтому fetch/push/status одного repo не пересекаются. Разные contexts работают параллельно.

Task metadata:

- operation ID;
- repo ID;
- kind;
- read/write/destructive classification;
- priority;
- dedupe key;
- AbortSignal;
- timestamps;
- user/automation/bulk origin.

`GitTimeoutPolicy` задаёт default deadline по operation class: короткий для local read, отдельный configurable deadline для network/credential operations и более длинный для clone/large history. User action может уменьшить deadline или отменить operation; бесконечный timeout не является default. Credential/askpass time входит в тот же deadline.

Cancellation semantics:

- Один `AbortSignal` проходит от UI/automation/bulk через queue и backend до `GitCommandRunner`.
- Queued task при abort удаляется/помечается cancelled без запуска. Running task прекращает stdin/progress, посылает graceful termination, ждёт bounded grace period и затем завершает весь process tree принудительно через platform adapter. Это важно, потому что Git может породить SSH, credential helper или hook child processes.
- Runner в `finally` закрывает pipes/watchers, удаляет secure temp files и askpass resources, redacts captured output и возвращает structured `GitCancelledError` либо `GitTimeoutError` с `repoId`, `operationId`, phase и deadline.
- Queue освобождает running slot в `finally` даже если termination/cleanup частично failed. Cleanup failure прикрепляется к structured error и не скрывает первоначальную причину.
- После отменённой read-only operation предыдущий valid snapshot остаётся видимым с `stale=true` и cancelled operation state.
- После отменённой mutating/network operation результат считается потенциально partial: store получает `stateConfidence="unknown"`, current operation очищается, выполняется authoritative status/ref/sequencer probe. До успешного probe dependent mutations блокируются.
- Pull/merge/rebase/checkout abort не вызывает автоматический rollback. Если остаются lock files или sequencer state, context переходит в `attention-required` с recovery actions.
- Timeout/cancel не retry автоматически, кроме явно idempotent read/fetch operation после fresh state probe и нового operation ID.

Reject одной task не останавливает queue. Destructive operation, commit, merge/rebase continuation и push не повторяются автоматически без доказанной идемпотентности.

### 7.12 RepositoryDiscovery

Discovery pipeline:

- Получить абсолютный vault root и фактический `configDir` из Obsidian adapter/app.
- Перечислить прямые каталоги `<vault>/<configDir>/plugins/*`.
- В будущем добавить explicit user paths и opt-in recursive roots.
- Для каждого candidate создать provisional context и выполнить `rev-parse --show-toplevel`, `--absolute-git-dir`, `--git-common-dir`, `--is-inside-work-tree`, `--show-superproject-working-tree`.
- Нормализовать realpath, Windows casing и path separators.
- Регистрировать candidate только если реальный top-level равен candidate root. Это не позволяет ошибочно зарегистрировать каждую plugin folder как часть ancestor vault repo.
- `.git` directory и `.git` gitfile поддерживаются одинаково через Git probe.
- Submodule отмечается metadata `superprojectRoot`, но остаётся независимым context.
- Обычный nested repository регистрируется независимо; resolver выбирает самый глубокий matching root.
- Symlink/display path и canonical real root хранятся отдельно; persistent identity разрешается через locator из раздела 7.5.
- Duplicate roots схлопываются в один context с aliases.

Discovery сначала пытается разрешить persistent locator, затем связывает найденный canonical root с UUID. Для нового candidate создаётся новый UUID/locator binding. При неоднозначном rename matching система не угадывает по remote URL и предлагает explicit relink metadata.

### 7.13 ActiveRepositoryResolver

Resolver принимает vault-relative или absolute path, нормализует его и ищет longest matching registered root. Вложенный repository всегда выигрывает у внешнего. Для удалённого файла используется безопасный lexical fallback. Результат — `resolved | outside | ambiguous | repository-missing`, а не nullable global active manager.

### 7.14 RepositoryWatcher и RepositoryWatchCoordinator

`RepositoryWatcher` — per-context adapter над filesystem notifications. Он наблюдает:

- worktree, включая изменения от OpenCode, Codex, VS Code, npm/build, обычного Git CLI и внешних редакторов;
- resolved `gitDir` и `commonDir`, а не только path `<root>/.git`, потому что у submodule `.git` является gitfile;
- как минимум `HEAD`, index, refs/packed-refs, sequencer/merge/rebase state и metadata, влияющие на status/upstream;
- исчезновение root/gitdir, переименование, возврат repository и watcher overflow/error.

`RepositoryWatchCoordinator` владеет lifecycle watchers и переводит сырые события в targeted invalidations:

- ключ debounce — `repoId` плюс категория `worktree | index | refs | operation-state | topology`; глобального debounce нет;
- event storm не создаёт unbounded queue: context получает dirty bit, bounded event summary и максимум один выполняющийся плюс один следующий refresh;
- overflow или потеря точности переводит только затронутый context в `rescan-required` и запускает authoritative status/probe;
- удаление root переводит context в `missing`, останавливает watcher handles и запускает дешёвый locator presence probe; возврат восстанавливает descriptor, relations и watcher без потери UUID/settings;
- watcher не пишет `RepoStore` напрямую: он вызывает `RefreshCoordinator.invalidate(repoId, reason)`, а store получает только generation-checked backend snapshot;
- Obsidian vault events входят в тот же coordinator как дополнительный hint. Они не являются обязательными для correctness.

Для `disjoint` event Repo A обновляет только Repo A. Relation propagation выполняется только когда state другого context реально наблюдаем: смена HEAD submodule invalidates status superproject; topology event может пересчитать relation graph; ordinary nested event затрагивает parent только если ownership/index analysis показывает, что parent status способен измениться. Никогда не выполняется status всех repositories.

### 7.15 SafetyBackupService

Backup storage abstracted через `BackupStorageProvider`.

Default location должна находиться вне `.obsidian/plugins/git`, потому что сам новый plugin будет управляемым repository. Предпочтение:

- OS/application data directory вне vault, если доступен надёжный platform adapter;
- иначе `<vault>/<configDir>/.git-plugin-data/backups`, sibling каталога `plugins`, с обязательной проверкой, что путь не находится внутри target repository;
- user-configured external directory для vault-root repository.

Если storage находится внутри target repository или недоступен, destructive operation блокируется.

Snapshot может включать:

- точные affected worktree files, включая untracked;
- binary content, symlinks, executable bits и empty directories where relevant;
- `git diff --binary` для worktree и index;
- HEAD, branch/upstream и affected ref OIDs;
- Git bundle/ref snapshot для history-rewriting/ref-destructive operations;
- manifest с repoId, canonical root, operation, argv category, timestamp, file hashes и Git state;
- verification report.

Pipeline:

- Построить preflight plan и exact affected targets.
- Создать snapshot во временном sibling directory.
- Проверить file count, SHA-256, manifest completeness и bundle validity.
- Atomic rename временного snapshot в final backup directory.
- Только после успешной verification запустить destructive Git operation.
- При partial Git failure вернуть structured error с backup ID/path; не продолжать chained operation.
- Retention cleanup не выполняется во время destructive operation и никогда не удаляет последний verified backup автоматически.

Destructive policy включает как минимум discard file/all, reverse patch to worktree, `reset --hard`, `clean`, force checkout, force branch delete, abort operation с пользовательскими resolution edits и force push.

Force push по умолчанию запрещён и не является boolean option обычного `PushRequest`. Если позже появится отдельная explicit `ForceUpdateRemoteRef` operation, она обязана:

- запросить фактический OID конкретного remote ref непосредственно у remote, например через `ls-remote`, а не доверять потенциально устаревшему `refs/remotes/<remote>/<branch>`;
- сохранить ожидаемый remote OID, ref name и timestamp в verified operation manifest;
- fetch именно этот remote ref в уникальный локальный protected backup ref, затем проверить, что backup ref разрешается ровно в `expectedOid`; если remote успел измениться или объект нельзя сохранить локально, прервать operation и начать preflight заново;
- выполнить push только с exact refspec и explicit lease `--force-with-lease=<remoteRef>:<expectedOid>`;
- отклонить operation, если remote ref изменился между probe и push, объект/backup не сохранён или expected OID неоднозначен;
- пройти trust/network policy, explicit confirmation, boundary plan и verified backup. Plain `--force`, bare `--force-with-lease` и lease на основании только local tracking ref запрещены.

### 7.16 ConflictManager

Source of truth:

- porcelain v2 unmerged records;
- `git ls-files -u -z` index stages;
- Git directory/sequencer state: merge, rebase, cherry-pick, revert.

Для файла читаются base `:1:`, ours `:2:` и theirs `:3:`. UI labels учитывают, что семантика ours/theirs при rebase отличается от merge. Marker parser используется только для удобного разбиения текстового файла, но не решает, есть ли Git conflict.

Действия:

- choose ours/current side;
- choose theirs/incoming side;
- both с явным порядком;
- manual editor;
- сохранить файл;
- stage resolved;
- continue конкретную operation;
- abort через safety guard.

Conflict view не commit/push автоматически. Continue, commit и push остаются отдельными явными действиями. Binary conflicts и modify/delete conflicts показываются как отдельные typed cases.

### 7.17 Diff/Hunk subsystem

- Pure hunk parser/transformations адаптируются из Obsidian Git вместе с tests.
- View state содержит `repoId`, repo-relative path, left/right refs и expected snapshot IDs.
- Stage hunk идёт через `HunkService -> context.queue -> backend.applyIndexPatch`.
- Unstage hunk использует reverse cached patch через тот же backend.
- Reset hunk изменяет worktree и поэтому сначала вызывает `SafetyBackupService`.
- Перед apply backend повторно проверяет expected blob/index/worktree identity; stale hunk возвращает `StaleDiffError` и предлагает refresh.
- Patch передаётся stdin или unique secure temp file; общий plugin patch file запрещён.
- Next/previous hunk — local editor navigation, но resolution target всё равно привязан к repoId/path.

### 7.18 RemoteService

`RemoteService` — application service поверх того же `GitBackend`, а не второй Git engine или GitHub client:

```ts
interface RemoteService {
  listRemotes(repoId: RepositoryId): Promise<readonly RemoteInfo[]>;
  getRemoteUrl(repoId: RepositoryId, remote: RemoteName, kind: "fetch" | "push"): Promise<string | null>;
  addRemote(repoId: RepositoryId, remote: RemoteName, url: RemoteUrl): Promise<void>;
  setRemoteUrl(repoId: RepositoryId, remote: RemoteName, url: RemoteUrl, kind: "fetch" | "push"): Promise<void>;
  removeRemote(repoId: RepositoryId, remote: RemoteName): Promise<void>;
  readUpstream(repoId: RepositoryId, localBranch: LocalBranchName): Promise<UpstreamInfo | null>;
  setUpstream(repoId: RepositoryId, localBranch: LocalBranchName, remote: RemoteName, remoteBranch: RemoteBranchName): Promise<void>;
}
```

- `RemoteInfo` различает fetch URL и все push URLs/refspecs.
- Upstream читается из `branch.<name>.remote`, `branch.<name>.merge` и проверяется через resolved upstream ref. Detached HEAD и отсутствующий upstream возвращаются typed state, а не fallback.
- `fetch`, `pull` и `push` requests всегда содержат explicit remote/refspec либо используют уже проверенный configured upstream. Они никогда не предполагают `origin`, `main` или `master`.
- `pull` отдельно задаёт strategy (`ff-only`, merge или rebase); UI не маскирует её как generic sync.
- Обычные remote CRUD, fetch/pull/push работают только через Git CLI. GitHub API не является dependency и нужен лишь будущим provider-specific функциям вне этого service.
- Remote changes являются mutating config operations, проходят queue, trust/execution policy и targeted refresh.

### 7.19 Dashboard и bulk operations

`DashboardProjection` — read-only агрегат snapshots, не global `RepoStore` и не source of truth.

Card показывает name, path, branch, dirty counts, conflicts, ahead/behind, operation, last network actions и error конкретного repo.

`BulkOperationService`:

- принимает explicit set repo IDs;
- запускает tasks через queues contexts;
- ограничивает межрепозиторный concurrency, например 4;
- использует all-settled semantics;
- не отменяет successful repos из-за одного failure;
- выдаёт `BulkOperationReport` по каждому repo со status, duration, result/error и skipped reason.

Безопасные defaults:

- Refresh all и Fetch all разрешены сразу.
- Pull all по умолчанию использует per-repo configured strategy, recommended default `ff-only`; dirty/conflicted repo получает `skipped/precondition-failed`.
- Push all никогда не force-push и не угадывает remote/upstream.
- Commit selected показывает preview и message для каждого changed repo; conflicts блокируют только соответствующий repo.

### 7.20 AutomationCoordinator

Coordinator хранит `Map<repoId, RepositoryScheduleState>`, но не Git state. Per-repo settings включают independent fetch/pull/commit/push intervals, event-driven debounce, pause и persisted `nextRunAt`.

Рекомендуется один timer wheel/min-heap вместо четырёх timers на каждый repository. Наступившая задача dispatch в queue context. Restart восстанавливает schedule из persisted wall-clock timestamps.

Safe defaults:

- Всё выключено по умолчанию, кроме optional auto-fetch после явного opt-in.
- Auto-pull не стартует на dirty/conflicted repo.
- Auto-commit не stage-all без отдельного явного policy.
- Auto-push не запускается после failed commit/pull.
- Один repo в conflict может быть paused независимо; остальные продолжают работу.

### 7.21 ExternalToolsService

Каждое действие принимает `repoId`, разрешает context и использует `cwd=context.descriptor.rootPath`.

- Open terminal here;
- Open OpenCode here;
- Copy repository path;
- Open external editor.

Executable и arguments хранятся раздельно. Запуск — `spawn(executable, args, {cwd, shell:false})`. Пользовательский shell command template не является default API. Embedded terminal sessions также key by repoId и показывают repository label/path.

### 7.22 Нормативное поведение ключевых topology/trust сценариев

#### Два независимых repositories

Для A и B relation равна `disjoint`. Operation A использует только queue/backend/store A; watcher event A вызывает status только A. Mutating test требует byte-for-byte неизменности worktree, index и refs B. Bulk action всё равно декомпозируется на две независимые tasks и формирует два результата.

#### Обычный nested repository

Resolver выбирает самый глубокий root для файла child. Parent и child остаются независимыми contexts, связанными `nested`, а не submodule semantics. Path-ownership projection отдельно выявляет файлы child, которые также tracked parent. Перед broad parent mutation boundary policy проверяет child root: операция либо получает доказуемое исключение child paths, либо блокируется. Child mutation tracked-overlap path также требует explicit cross-context plan. Parent refresh допускается лишь если его index/ownership действительно делает child change наблюдаемым; глобального refresh нет.

#### Git submodule и superproject

Child и parent имеют отдельные contexts, queues, stores и backends, связанные `submodule-of`/`superproject-of`. Checkout/commit в child меняет child HEAD и refs в принадлежащем child gitdir, даже если физически он расположен в `.git/modules` superproject. Gitlink status parent закономерно становится dirty, поэтому watcher invalidates parent status. Это не нарушение isolation и не означает автоматический stage/commit gitlink в parent. Recursive parent operation, меняющая child worktree/HEAD, разрешена только как explicit cross-context operation с обоими participants, safety/trust checks и детерминированным queue acquisition.

#### Repository, изменяемый OpenCode или Codex

External tool запускается с exact cwd выбранного context, но корректность наблюдения от этого запуска не зависит. Per-repo watcher видит worktree и Git metadata changes, coalesces event storm от save/build/Git commands и invalidates только этот RepoStore. Если внешний process оставил partial merge/rebase/index lock, authoritative probe отражает operation state; плагин не пытается автоматически откатить изменения.

#### Автоматически обнаруженный untrusted repository

Context регистрируется и может показывать минимальный безопасный read-only snapshot через hardened execution profile. Hooks, helpers, SSH, filters, merge/diff drivers и другие command-executing configuration не запускаются. Mutating/network action возвращает `RepositoryTrustRequiredError`; после явного trust обычные SSH/credential/hooks workflows разрешаются в рамках operation policy, timeout и redaction. Trust другого context не наследуется даже при nested/submodule relation.

## 8. Архитектурные риски

| Риск | Последствие | Mitigation |
| --- | --- | --- |
| Скрытая singleton-зависимость в UI | Operation уходит в выбранный ранее repo | UI получает controller + repoId, backend недоступен |
| Два Git engines | Несовместимые status/diff/commit semantics | Один `DesktopGitBackend`; direct argv только его внутренняя реализация |
| Discovery принимает ancestor repo | Все plugin folders указывают на vault repo | Сравнение canonical candidate с `--show-toplevel` |
| Path traversal/cross-repo path | Repository A меняет B | Branded repo-relative paths, root containment, запрет retarget flags |
| Nested/submodule ошибочно считаются disjoint | Ложное нарушение isolation либо потеря child data | Relation graph, gitlink verification, affected path/ref preflight |
| Broad parent operation пересекает child root | Parent checkout/reset/clean меняет другой context | Fail-closed boundary policy; explicit cross-context operation |
| Concurrent fetch/push/status одного repo | Locks, inconsistent store, corruption | Одна queue на context для всех Git commands |
| Global debounce или только Obsidian events | External edit не виден либо refresh всех | Per-repo worktree/gitdir watcher + keyed coordinator |
| Watcher event storm/overflow | Unbounded queue или потерянное изменение | Dirty bit, bounded summary, один follow-up refresh, targeted rescan |
| Git запускает repository-defined code | Hooks/helpers/filters выполняются в auto-discovered repo | Trust policy, hardened read-only allowlist, execution profiles |
| Network/helper process зависает | Queue repo заблокирована навсегда | Deadline, AbortSignal, process-tree termination, cleanup in `finally` |
| Cancelled mutation оставляет partial state | Store показывает ложное clean/ready | Unknown confidence, authoritative state probe, attention-required |
| Несогласованные status списки | Один файл теряет dual index/worktree state | Canonical `FileStatusEntry`; UI lists только derived projections |
| Remote logic предполагает `origin/main` | Push/pull идёт не туда или не работает | RemoteService с explicit remote/ref/upstream |
| Bare `--force-with-lease` использует stale tracking ref | Чужой remote update перезаписан | Fresh remote OID, local protected ref, explicit `<ref>:<expectedOid>` |
| Stale diff/hunk | Patch применён к новой версии файла | Expected snapshot/OID precondition |
| Backup внутри plugin `git` repo | Self-pollution и recursive backups | External/sibling storage provider + containment validation |
| Backup только файлов | Нельзя восстановить refs/index | Manifest, binary patches, ref OIDs и Git bundle where needed |
| Backup write partially succeeds | Ложное ощущение безопасности | Temp snapshot, hashes, verification, atomic finalize, fail-closed |
| Conflict markers как truth | Binary/modify-delete/rebase cases потеряны | Index stages + sequencer state |
| Ours/theirs ambiguity при rebase | Выбрана обратная сторона | Operation-aware semantic labels |
| Auto recovery discard/reset | Потеря кода | Только deterministic non-destructive recovery; destructive требует intent + backup |
| Authentication prompt зависает automation | Queue блокируется | Non-interactive Git + scoped credential broker |
| Secrets попадают в logs/errors | Credential leak | Central redaction before store/log/UI |
| Graph запускает command per row | Плохая работа на больших histories | Batch log stats, cache, virtualization |
| Repository исчезает mid-operation | Dangling context и неверный result | Lifecycle `missing`, generation checks, structured failure |
| Repository ID меняется при переносе vault | Теряются per-repo settings | UUID + vault-relative locator; runtime realpath отдельно |
| External repository path меняется | UUID ошибочно перевыдан | External locator ID + last-known path + explicit relink |
| API слишком широкий | UI обходит safety | Application facades и module-boundary tests |
| Mobile abstraction ограничена desktop assumptions | Дорогая переработка | Capability-based port, byte-oriented file content, no simple-git types в domain |
| Первоначальный план ставит Safety после discard | Нарушение обязательного backup | Перенести safety foundation до Source Control discard |

## 9. Рекомендуемый порядок разработки

### Этап 0 — исследование

Этот документ. После него остановиться до подтверждения.

### Этап 1 — architecture baseline

- Создать `ARCHITECTURE.md`, ADR для backend ownership, relation graph/cross-context operations, queue timeout/cancellation, watcher lifecycle, trust/execution profiles, backup storage и repository locator identity.
- Создать dependency-boundary rules и type-level `RepositoryId`/`RepoRelativePath`.
- Создать `LICENSE` и initial `THIRD_PARTY_NOTICES.md` до первого переноса кода.
- Провести formal review обоих isolation invariants: найти каждый путь запуска Git, каждое repository event и каждую команду, способную пересечь context boundary.

### Этап 2 — read-only Git core

- Scaffold project `git`.
- Реализовать Git runtime capability check.
- Реализовать locator binding, provisional context, discovery, registry, relation graph, resolver, queue и backend read operations.
- Реализовать trust/execution policy до первого probe автоматически обнаруженного repository.
- Реализовать per-repo watcher/coordinator, timeout/cancellation runner и canonical porcelain v2 `FileStatusEntry` model.
- Реализовать read-only часть RemoteService: remotes, URLs, upstream, branch/ahead/behind.
- Критерий: все `.obsidian/plugins/*` repositories обнаруживаются, получают стабильные UUID после переноса test vault и независимо обновляются при внешних worktree/Git metadata changes без UI сложнее diagnostic command/view.

### Этап 3 — safety foundation

- Реализовать backup storage provider, manifests, verification и destructive policy.
- Реализовать fault injection tests до первой destructive command.
- Критерий: при любой backup failure destructive command вообще не вызывается.

### Этап 4 — Source Control

- Stage/unstage file/all, commit/amend, fetch/pull/push и RemoteService CRUD/upstream.
- Discard появляется только через готовый safety guard.
- Добавить repository picker и explicit repoId in view state.
- Mutations сначала проходят relation-aware affected path/ref plan; network operations требуют trusted context.

### Этап 5 — Dashboard и bulk

- Repository cards и aggregate projection.
- Refresh/fetch/pull/push all с concurrency limit и отчётом.
- Commit selected только с preview и per-repo result.

### Этап 6 — Diff/Hunks

- Адаптировать Obsidian Git pure hunk engine и tests.
- CodeMirror MergeView, stale patch protection, stage/unstage/reset hunk.

### Этап 7 — History/Graph/Branches

- Batch log, file history, graph layout/virtualization.
- Branch create/checkout/delete, remote branches и upstream.
- Любая force/destructive branch action через safety policy.
- Force push остаётся отсутствующим; будущая реализация допускается только как отдельная operation с fresh remote OID и explicit lease.

### Этап 8 — Conflicts

- Git index stage model и sequencer state.
- Text, binary, add/add, modify/delete, rename conflict UI.
- Continue/abort with typed operation handling.

### Этап 9 — Automation

- Per-repo schedule, persisted next run, pause, targeted watcher trigger.
- Никаких AI actions.

### Этап 10 — External development tools

- Terminal/OpenCode/editor adapters с exact repo cwd.
- Embedded terminal sessions keyed by repoId.

### Этап 11 — Mobile backend

- Реализовать capability-compatible `MobileGitBackend` на isomorphic-git.
- Только после parity tests снять desktop-only ограничение.

Изменение относительно исходного порядка принципиально одно: SafetyBackupService поднят перед Source Control discard. Это необходимо для соблюдения заявленной модели безопасности.

## 10. План тестирования

### 10.1 Уровни

- Unit: parsers, path policy, resolver, store reducers/fingerprints, queue, graph layout, hunk transformations, destructive classification, backup manifests.
- Integration с настоящим system Git: временные repositories и bare remotes, без mocks для Git semantics.
- Fault injection: command failures, write failures, hash mismatch, repository disappearance, auth and timeout.
- Topology: disjoint, ordinary nested, submodule/superproject и explicit cross-context operations.
- Security: untrusted repositories с hooks/configured helpers/filters/drivers, trust transitions и execution-profile assertions.
- Watcher: external filesystem/Git metadata changes, event storms, overflow, delete/return и process-count assertions.
- Obsidian E2E: views, view-state repoId, commands, repository picker, dashboard isolation и reload persistence.
- Performance: process count, refresh targeting, graph DOM row count и bulk concurrency.
- Cross-platform CI: Linux, Windows, macOS для paths, executable bits/symlinks where supported и askpass behavior.

### 10.2 Обязательная матрица сценариев

| № | Сценарий | Главная проверка |
| --- | --- | --- |
| 1 | Один repository | discovery, status и operations относятся к его context |
| 2 | Два независимых repositories | relation `disjoint`; разные IDs/backends/stores/queues; A byte-for-byte не меняет B |
| 3 | 20 repositories | bounded discovery/bulk concurrency; watcher event A не вызывает status остальных 19 |
| 4 | Dirty + clean | dashboard counts корректны; bulk skip не смешивает results |
| 5 | Разные branches | branch state не протекает между stores |
| 6 | Staged + unstaged одного файла | одна canonical entry имеет оба states и присутствует в обеих derived projections; commit берёт только index |
| 7 | Untracked files | porcelain `-z`, stage/discard backup и nested repo distinction |
| 8 | Rename | originalPath/newPath, stage/unstage и file history across rename |
| 9 | Delete | status, staging и backup-before-discard/restore |
| 10 | Conflict | index stages, file list, resolution и continue без auto-destruction |
| 11 | Ahead | точный commit count и push action |
| 12 | Behind | точный count и pull/ff-only behavior |
| 13 | Diverged | оба counts; normal push rejected; no force/reset |
| 14 | Missing remote | structured repo-local error; другие repositories работают |
| 15 | Authentication failure | prompt/fail-fast, secret redaction, queue освобождается |
| 16 | Repository удалён во время работы | lifecycle missing, no crash/global block, stale result ignored |
| 17 | Новый repository появляется | rescan adds context/event/dashboard card без reload |
| 18 | Git submodule | relation graph, `.git` gitfile, child HEAD invalidates parent gitlink status без ложного isolation failure |
| 19 | Обычный nested repository | longest-root resolver выбирает child; unsafe broad outer operation блокируется или доказуемо исключает boundary |
| 20 | Одновременная operation в двух repositories | disjoint contexts реально overlap; same-repo operations serial; cross-context participants coordinated |

### 10.3 Инвариантные isolation tests

Для каждого Git method backend/application API test требует непустые `primaryRepoId` и `operationId`; для cross-context operation дополнительно требуется явный непустой participant set, существующая relation и deterministic multi-queue acquisition. Command-runner test записывает cwd, argv, execution profile и affected plan каждого process; context-free и retargeted command отклоняется.

Для каждого mutating method создаются действительно независимые Repo A и Repo B с relation `disjoint`. Перед operation фиксируются:

- HEAD/ref OIDs B;
- `git status --porcelain=v2 -z` B;
- content hashes всех files B;
- index tree B;
- remote refs B where applicable.

После operation в A все значения B должны быть byte-for-byte неизменны. Operation ID A никогда не запускается с cwd B и не содержит affected paths/refs B.

Для `nested` и submodule/superproject byte-for-byte assertion целиком не применяется. Вместо этого используются relation-aware assertions:

- nested child files/refs/index не изменяются broad parent operation; если exclusion нельзя доказать, runner не вызывается;
- child submodule checkout/commit может изменить computed gitlink status parent, но не parent HEAD, refs, index или ordinary worktree files;
- parent получает ровно targeted invalidation/refresh после child HEAD change;
- stage gitlink или recursive submodule update возможны только как explicit cross-context operation с обоими participants;
- после relation-aware operation любые изменения вне declared affected path/ref plan считаются нарушением второго инварианта.

Таким образом отдельно проверяются оба свойства: любая Git-операция имеет primary `RepositoryContext`; ни одна mutation не пересекает context boundary без relation и explicit operation plan.

### 10.4 Queue/concurrency tests

- Barrier-based fake runner доказывает, что две операции одного context не overlap.
- Два contexts достигают barrier одновременно, доказывая разрешённый parallelism.
- Reject первой task не блокирует вторую.
- Duplicate refresh coalesces.
- Automation task не обгоняет уже queued user mutation.
- Dispose/missing context отклоняет новые tasks и не применяет поздний snapshot.
- Abort queued task не запускает runner и освобождает dedupe key.
- Timeout running process завершает process tree после grace period и запускает следующую task.
- Credential helper/SSH/hook child process также завершается; temp/askpass files и pipes очищаются.
- Cancelled mutation переводит store в unknown/stale, запускает authoritative probe и блокирует следующую mutation до восстановления confidence.
- Cross-context coordinator получает participant queues в стабильном порядке; две операции с обратным порядком participants не deadlock.

### 10.5 Safety tests

- Permission denied при создании backup.
- Simulated disk full.
- Hash mismatch после copy.
- Неудачный Git bundle verify.
- Backup path ошибочно внутри target repo.
- Partial file list и path traversal.
- Symlink, executable, binary и zero-byte file.
- Untracked directory перед clean.
- Staged + unstaged variants перед reset/checkout.
- Во всех failures mock/spy подтверждает: destructive command count равен нулю.
- Успешный restore воспроизводит worktree, index и refs для каждого destructive kind.

### 10.6 Diff/Hunk tests

- Add/delete/change at beginning, middle и EOF.
- No newline at EOF и CRLF.
- Unicode и filenames с spaces/tabs/newlines.
- Partial selection inside hunk.
- Stage, unstage и reverse worktree patch round trip через реальный Git.
- Stale snapshot: файл изменён после render, patch отвергается.
- Operation A hunk никогда не применяется к одинаковому path в disjoint Repo B.

### 10.7 Conflict tests

- content both-modified;
- add/add;
- modify/delete и delete/modify;
- rename/rename и rename/delete;
- binary conflict;
- merge, rebase, cherry-pick и revert sequencer states;
- semantic labels ours/theirs для merge и rebase;
- partial resolution, reload и continue;
- abort после manual edits создаёт verified backup.

### 10.8 Performance acceptance

- Один file event в disjoint Repo A вызывает не более одного coalesced status A и ноль status в остальных repositories.
- Один submodule HEAD event вызывает status child и ровно один coalesced status его superproject, но не unrelated repositories.
- Dashboard opening может делать bounded initial refresh, не unbounded `Promise.all` на сотни процессов.
- Bulk concurrency configurable и bounded.
- Graph DOM содержит viewport window, а не все commits.
- Log stats приходят batch; нет per-row Git process.
- Process-count assertions входят в integration tests для 20 repositories.

### 10.9 Topology и boundary tests

- Relation detection: disjoint roots, ordinary nested root, valid submodule gitlink/gitfile и inverse superproject edge.
- False-positive defense: nested directory с `.git` не становится submodule без gitlink/index evidence.
- Relation graph обновляется после изменения `.gitmodules`, index gitlink, удаления и возврата child.
- `stage all`, `discard all`, checkout/reset/clean parent проходят affected-path preflight и не пересекают nested child boundary.
- Child mutation tracked-overlap path обычного nested repository блокируется без parent participant; opaque/ignored child path остаётся child-local.
- Неопределимый affected set приводит к `CrossRepositoryBoundaryError` до Git process и до destructive backup execution.
- Explicit recursive submodule operation проверяет participant trust/safety для каждого context и меняет только declared paths/refs.
- Push в local-path remote, который зарегистрирован как другой context, требует explicit participant и проверяет ref plan; обычный network remote остаётся вне registry.

### 10.10 RepositoryWatcher tests

- Изменение source file внешним editor/OpenCode/Codex обновляет только соответствующий store.
- `git add`, commit, checkout и branch update из внешнего CLI обнаруживаются через index/HEAD/refs watcher.
- npm/build storm из тысяч events схлопывается в один running и максимум один follow-up refresh.
- Watcher overflow/error даёт targeted authoritative rescan, не silent loss и не status-all.
- Удаление repository переводит context в `missing`; возврат по тому же locator восстанавливает UUID, settings и watcher handles.
- Atomic-save rename, symlink/display path и `.git` gitfile/commonDir корректно сопоставляются context.
- Dispose закрывает все handles; поздний event не применяет snapshot к новому generation.

### 10.11 RepositoryTrustPolicy и GitExecutionPolicy tests

- Auto-discovered repository начинается `untrusted`; safe status/rev-parse разрешены, commit/checkout/fetch/push блокируются.
- `pre-commit`, `post-checkout`, `core.hooksPath` scripts не запускаются untrusted profile.
- Fake `credential.helper`, `core.sshCommand`, `filter.*`, merge driver, external diff/textconv и fsmonitor оставляют sentinel untouched.
- Неизвестная command-executing config приводит к fail-closed policy decision, а origin/scope отражаются в structured diagnostic.
- После explicit trust обычные SSH/credential helper и hooks работают только для соответствующего RepositoryId; соседний/nested context trust не наследует.
- Revocation немедленно блокирует новые mutating/network tasks, но не меняет repository data.

### 10.12 RemoteService и force-with-lease tests

- Repository с remote, не называющимся `origin`, и branch, не называющейся `main/master`, корректно list/read/fetch/push по explicit config.
- Несколько fetch/push URLs и refspecs читаются без потери; add/set/remove remote проходят queue и targeted refresh.
- Upstream absent, detached HEAD, local branch с custom remote branch и удалённый remote возвращают typed states/errors.
- Remote CRUD и ordinary Git operations не вызывают GitHub API.
- Force push отсутствует в default API и UI.
- Для отдельной future force operation remote ref OID читается у remote, fetch сохраняет его в unique local protected ref, equality проверяется до push.
- Race: remote меняется после probe; explicit `--force-with-lease=<ref>:<expectedOid>` отклоняет push, новый remote commit сохраняется.
- Bare `--force`, bare `--force-with-lease` и lease на основе только stale remote-tracking ref запрещаются policy test.

### 10.13 Repository identity tests

- Vault переносится между двумя absolute roots; vault-relative locator разрешается заново, UUID и все per-repo settings остаются прежними.
- Два clones с одинаковым remote URL получают разные UUID.
- Rename/move внутри vault обновляет locator только через однозначный relink flow.
- External locator сохраняет UUID при explicit relink на новый path; last-known absolute path сам по себе не доказывает identity.
- Ambiguous locator/root conflict не создаёт новый silent binding и возвращает structured error.

### 10.14 Canonical file-status tests

- Все porcelain v2 record types `1`, `2`, `u`, `?` с `-z` преобразуются без потери path/originalPath и index/worktree codes.
- Один файл с staged и unstaged changes существует один раз в canonical array и появляется в обеих derived projections.
- Rename/copy similarity, delete в index versus worktree, untracked и conflict stages не создают конкурирующие entries.
- UI projections после refresh всегда пересчитываются из одного generation/fingerprint и не могут обновляться независимо.

### 10.15 Timeout/cancellation state tests

- Local read, network и clone получают разные configurable deadlines; credential prompt входит в network deadline.
- SIGTERM/grace/forced tree termination проверяются platform adapter tests на Linux, macOS и Windows.
- Cleanup failure сохраняется как secondary cause, queue всё равно освобождается.
- Cancelled read сохраняет последний valid snapshot как stale; cancelled mutation/fetch/pull выполняет status/ref/sequencer probe.
- Partial fetch ref update, interrupted pull и оставшийся sequencer/lock state дают `attention-required`, а не ложный success/clean.

## 11. Лицензии и notices

Все семь проверенных donor repositories используют MIT License в указанных commits.

План для нового проекта:

- Рекомендуемая лицензия нового проекта — MIT для совместимости с донорами. Copyright holder нового проекта должен быть указан владельцем проекта перед созданием окончательного `LICENSE`.
- `THIRD_PARTY_NOTICES.md` создаётся до первого существенного переноса кода.
- Для каждого donor включается project name, authors/copyright, URL, exact source commit, использованные файлы/идеи и полный MIT notice либо однозначная ссылка на включённую копию текста лицензии.
- При существенном копировании сохраняются существующие file headers. Если headers отсутствуют, origin отмечается рядом с адаптированным module и обязательно в notices.
- Dependency licenses проверяются отдельно при выборе package versions; MIT лицензии donor repository не покрывают автоматически dependencies.

Обязательные entries:

| Проект | Copyright из LICENSE | Планируемое использование |
| --- | --- | --- |
| Obsidian Git | Copyright (c) 2020 Vinzent03, Denis Olehov | Git backend behavior, hunk/diff code, automation ideas |
| Git History | Copyright (c) 2025 Chris Oguntolu | RepoStore, Source Control, graph/history, parsers/tests |
| Agentic Git Sync | Copyright (c) 2026 Jakob | Dashboard, per-repo manager/bulk/error-isolation ideas |
| Git File Explorer | Copyright (c) 2023 Mateus Molina | Path-bound repository and markers ideas |
| Easy Git | Copyright (c) 2026 Saiki77 | Fail-closed backup principles |
| CoNote Git | Copyright (c) 2024 Maximilian Witte | Per-mapping queue and dir/gitdir reference |
| GitFacil | Copyright (c) 2026 Alex Lazo | Simple argv execution reference |

Если после реализации от некоторых проектов останутся только абстрактные идеи, notice всё равно можно сохранить как прозрачную атрибуцию, хотя copyright обычно требует notice именно для copied/substantial portions.

## 12. Запрещённые архитектурные shortcuts

- Global `basePath`, `gitManager`, `repository`, `RepoStore` или `gitError`.
- Direct Git execution из UI, automation, dashboard, hunk или conflict code.
- Runtime switch: status через Git History service, commit через Obsidian Git manager, push через отдельный helper.
- Repository discovery только по `exists(.git)`.
- Persistent `RepositoryId`, вычисленный только из absolute path, inode или remote URL.
- Неявное предположение, что любые два contexts `disjoint`, либо безусловный byte-for-byte isolation test для submodule/superproject.
- Parent mutation через nested/submodule boundary без `AffectedPathPlan` и explicit relation-aware operation.
- Наблюдение только через Obsidian vault events или один global watcher/debounce.
- Выполнение auto-discovered repository как trusted только потому, что `shell:false`.
- Независимые mutable status lists вместо canonical `FileStatusEntry`.
- Fetch/pull/push с неявными `origin`, `main` или `master`.
- Repository queue без deadline, AbortSignal и process-tree cleanup.
- Automatic commit/pull/push pipeline как единственная семантика Git.
- Backup directory внутри управляемого plugin repository.
- `git clean`, hard reset, force checkout/branch delete/push без policy, verified backup и explicit intent.
- Plain force push, bare `--force-with-lease` или lease на основе stale remote-tracking ref.
- AI recovery до полностью работающего deterministic Git core.
- Mobile placeholder, который silently поддерживает только часть interface.
- Огромный `main.ts` и import `main` из lower layers.

## 13. Gate перед этапом 1

До подтверждения пользователя не создавать исходный код, manifest, package files, `ARCHITECTURE.md`, `LICENSE` или `THIRD_PARTY_NOTICES.md`.

После подтверждения первым результатом этапа 1 должны стать `ARCHITECTURE.md`, ADRs и dependency/invariant tests. Реализация Git core начинается только после повторной проверки, что:

- каждый backend bound к одному immutable root;
- каждый operation/event имеет repoId;
- persistent UUID отделён от runtime realpath и перенос vault покрыт test;
- relation graph различает disjoint/nested/submodule/superproject, а mutation имеет affected path/ref preflight;
- byte-for-byte isolation применяется только к disjoint contexts; relation-aware effects проверяются отдельно;
- UI не видит backend;
- bulk decomposes по contexts;
- watcher refreshes только target и доказуемо affected related contexts;
- untrusted execution profile не может запустить hooks/helpers/SSH/filters/drivers;
- RemoteService не предполагает remote/default branch names;
- canonical file status имеет один source of truth;
- abort/timeout освобождает queue и приводит store к проверяемому состоянию;
- destructive operation невозможно вызвать в обход safety guard;
- нет hidden fallback на vault root или global active repository.

## 14. Итоговый вывод

Архитектура жизнеспособна, если проект рассматривает repository не как настройку глобального plugin, а как самостоятельную runtime единицу. Лучшие донорские части совместимы при одном условии: их код сначала разрывается с singleton assumptions и помещается за одним context-bound backend/application boundary.

Рекомендуемая формула проекта:

```text
RepositoryRegistry
  -> RepositoryIdentity(repoId, portable locator)
  -> RepositoryRelationGraph(disjoint/nested/submodule/superproject)
  -> RepositoryContext(repoId, immutable runtime realpath)
       -> one GitBackend
       -> one RepoStore
       -> one OperationQueue
       -> one RepositoryWatcher
       -> one safety facade

UI/Bulk/Automation
  -> RepositoryController(repoId)
  -> Trust + Boundary policies
  -> context queue
  -> the same backend
```

Оба архитектурных инварианта соблюдены проектно: ни одна Git-операция не имеет допустимого пути выполнения без primary `RepositoryContext`; ни одна mutation не может пересечь context boundary без явной relation, participant set и cross-context operation plan. Изменение child submodule, отражающееся dirty gitlink status superproject, является смоделированным observable effect и вызывает targeted refresh, а не считается нарушением isolation.
