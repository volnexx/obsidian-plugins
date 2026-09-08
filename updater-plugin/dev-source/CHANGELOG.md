# Changelog

## 0.11.5 — 2026-09-08

- Added a left-sidebar tab, «Обновление плагинов», with a large
  «P — обновить плагины» button. On iPhone and Android the tab is created after
  layout restoration, without opening the sidebar or starting an update.
- Added «Открыть панель обновления плагинов» to commands and an open-panel button
  to Updater settings. Existing tabs, including deferred views, are reused.
- The button calls the existing `safeUpdateAll` entry point and reflects the
  shared busy/lock state. Rapid repeated taps cannot launch duplicate updates.
- Kept the desktop ribbon, update/backup behavior, and repository selection
  unchanged. The panel does not import Node modules or access `process` on mobile.
- Added automated tests for mobile startup, tab restoration, concurrent opening,
  duplicate taps, lock state, unload/error recovery, and Node-free iPhone/Android
  module loading and panel rendering.

Scope: this release adds launch controls. It does not change Codex lifecycle
detection, historical resolver diagnostics, or create/publish the mobile mirror.
Opening the panel does not check repository availability; update errors continue
to be reported by the existing update operation.
