# Development handoff

## Текущее состояние

Этап 3 (Safety Foundation) реализован на уровне production-кода, но обязательный safety integration/fault-injection gate ещё не завершён. Этап 3 пока **не закрыт**, и fast-MVP ещё не начинался.

Runtime destructive Git-команды не добавлялись. Production Git allowlist по-прежнему read-only; `RepositorySafetyFacade`, `StageTwoUnavailableSafetyFacade` и interface-only `VerifiedDestructiveExecutor` не получили destructive implementation.

Реализованы:

- runtime-проверяемый `BackupPlan`, производный от genuine validated destructive operation plan;
- versioned `BackupManifest`, связанный с plan/payload/backup-plan digests;
- structured backup errors;
- desktop backup storage с canonical containment, isolation от worktree/gitDir/commonDir, уникальным temp-каталогом и atomic finalize;
- filesystem-only snapshot worktree/index/refs/objects/config с SHA-256, symlink handling и pre/post TOCTOU identity checks;
- transaction `prepare -> capture -> manifest -> verify -> finalize -> verify -> capability`;
- issuer-specific immutable `VerifiedSafetyBackup`;
- restore service с полной проверкой capability/manifest/artifacts до изменения protected state;
- минимальный retention policy contract.

## Изменённые и созданные файлы

Файлы основной реализации этапа 3:

- `src/safety/BackupErrors.ts`
- `src/safety/BackupManifest.ts`
- `src/safety/BackupPlan.ts`
- `src/safety/BackupRetentionPolicy.ts`
- `src/safety/RuntimeSafetyBackupService.ts`
- `src/safety/SafetyBackupService.ts`
- `src/safety/restore/BackupRestoreService.ts`
- `src/safety/snapshot/BackupSnapshotEngine.ts`
- `src/safety/storage/BackupStorageProvider.ts`
- `src/safety/storage/DesktopBackupStorageProvider.ts`
- `src/safety/storage/SafetyFileSystem.ts`

Последние исправления:

- `src/safety/BackupPlan.ts` — устранены lint/type-safety проблемы runtime verification;
- `src/safety/RuntimeSafetyBackupService.ts` — исправлены type-only imports и статические проверки manifest binding;
- `src/safety/restore/BackupRestoreService.ts` — исправлены lint/narrowing проверки;
- `src/safety/snapshot/BackupSnapshotEngine.ts` — исправлено безопасное определение symbolic HEAD ref;
- `src/safety/storage/SafetyFileSystem.ts` — удалено использование deprecated `RmDirOptions`;
- `src/safety/storage/DesktopBackupStorageProvider.ts` — добавлен best-effort cleanup temp-каталога, если `prepare()` падает после `mkdtemp`, но до возврата allocation;
- `tests/safety-integration/safety-foundation.test.ts` — создан первый отдельный safety integration test;
- `package.json` — добавлен `npm run test:safety`; suite включён в `npm run verify`.

`main.js` был пересобран последним успешным полным `npm run verify`, выполненным до добавления нового safety test script.

## Состояние тестов

Подтверждённо проходит:

- `npm run typecheck` — проходил до добавления `tests/safety-integration/safety-foundation.test.ts`;
- прежний полный `npm run verify` — прошёл после исправлений production safety-кода, но до включения `test:safety` в verify chain;
- unit: 18/18;
- architecture: 30/30 и dependency-cruiser без нарушений;
- прежний real-Git integration suite: 10/10;
- production build;
- `npm run test:safety` — последний запуск: 1/1 passed.

Текущий safety test покрывает filesystem snapshot/verification для:

- text file;
- binary file;
- zero-byte file;
- executable file;
- symlink без следования по ссылке.

Первый запуск этого теста падал с `stale-backup-plan`, потому что сам test fixture создавал каталог backup внутри snapshot target. Fixture исправлен: backup root вынесен в отдельный временный каталог. Повторный запуск прошёл. Это не было production defect.

После добавления нового файла теста и включения `test:safety` в `verify` ещё не запускались:

- `npm run typecheck` на текущем дереве;
- lint на текущем дереве;
- полный обновлённый `npm run verify`.

Подтверждённых падающих тестов сейчас нет, но общий gate ещё неполный.

## Что незавершено

В отдельном safety suite пока отсутствуют обязательные cases:

- storage unavailable/write failure;
- partial write и cleanup;
- artifact hash/manifest corruption;
- stale file/index/ref state;
- backup path внутри target repository;
- symlink escape;
- foreign/tampered capability;
- cancellation;
- failure одного participant в cross-context/shared-common-dir backup;
- restore round-trip для staged-only, staged+unstaged, untracked/deleted;
- linked worktree/shared-common-dir;
- Repo A/Repo B isolation;
- при необходимости текущей архитектуры: timeout, rename failure, collision и digest mismatch.

Полный backup/restore transaction через genuine plan + authorization + active lease ещё не покрыт первым тестом. Текущий тест напрямую проверяет `BackupSnapshotEngine`.

Safety runtime намеренно не подключён к composition root до закрытия gate. Fast-MVP Source Control и минимальный UI не реализовывались.

## Следующий конкретный шаг

Расширить `tests/safety-integration/safety-foundation.test.ts` минимальным harness для genuine destructive plan/authorization/lease и real temporary Git repositories. Добавлять только перечисленные integration/fault-injection cases, исправляя production-код лишь при выявленном блокирующем defect.

После покрытия обязательного минимума выполнить по порядку:

- `npm run test:safety`;
- `npm run verify`.

Если оба проходят, этап 3 считается закрытым. Затем без нового согласования перейти к согласованному desktop fast-MVP: repository selection/status/changed files, stage/unstage file и all, commit, fetch, pull `ff-only`, non-force push, простой diff и понятные repo-local errors. Не расширять scope до advanced hunks, graph, advanced conflicts, rebase/amend/force operations, automation или mobile.

## Сохраняемые ограничения

- Не выполнять push/force-push над внешними remote во время разработки; remote operations тестировать только на временных local fixtures.
- Destructive Git tests выполнять только во временных repositories.
- Не изменять external remotes и пользовательские файлы вне текущего vault.
- Не делать release/publish.
- Не проводить новый архитектурный redesign или общий safety audit.
- После трёх неудачных разумных попыток исправить одну и ту же блокирующую проблему зафиксировать blocker и остановиться.
