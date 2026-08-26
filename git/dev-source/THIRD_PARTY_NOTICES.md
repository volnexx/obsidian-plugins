# Third-party notices

Дата проверки исходных проектов: 2026-08-21.

На этапе 1 Git runtime или реализация Git-функций из donor repositories не копировались. Использованы архитектурные идеи, API/UX-анализ и названия исходных файлов, зафиксированные в `ARCHITECTURE_RESEARCH.md`. Если на следующих этапах будет перенесён существенный код, соответствующий entry и file-level attribution MUST быть уточнены до merge.

Все donor snapshots ниже распространяются по MIT License. Общий текст лицензии приведён в приложении A.

## Obsidian Git

- Проект: Obsidian Git.
- Авторы/copyright: Copyright (c) 2020 Vinzent03, Denis Olehov.
- URL: https://github.com/Vinzent03/obsidian-git
- Проверенный commit: `e0598d9651618363b8c72e1f90955a6765c11ac4`.
- Лицензия: MIT.
- Этап 1: архитектурный анализ context-bound backend, operation queue, hunk и automation boundaries; код Git-функций не переносился.

## Git History

- Проект: Obsidian Git History.
- Автор/copyright: Copyright (c) 2025 Chris Oguntolu.
- URL: https://github.com/chrisurf/obsidian-git-history
- Проверенный commit: `eaec276bd9f6ca3e16eceeb79b344b6bef535703`.
- Лицензия: MIT.
- Этап 1: архитектурный анализ RepoStore, porcelain status model, Source Control и graph/history; реализация не переносилась.

## Agentic Git Sync

- Проект: Agentic Git Sync.
- Автор/copyright: Copyright (c) 2026 Jakob.
- URL: https://github.com/leweii/agentic-git-sync
- Проверенный commit: `2a82f02dbbdd118d21422b657b3230cf6dfdb20e`.
- Лицензия: MIT.
- Этап 1: идеи per-repository coordination, dashboard и all-settled bulk reporting; код не переносился.

## Git File Explorer

- Проект: Obsidian Git File Explorer.
- Автор/copyright: Copyright (c) 2023 Mateus Molina.
- URL: https://github.com/MateusMolina/obsidian-git-file-explorer
- Проверенный commit: `0a2b73c8537ecc75b56ecd0725e5736f4fbbe869`.
- Лицензия: MIT.
- Этап 1: идеи path-bound repository identity, markers и keyed debounce; код не переносился.

## Easy Git

- Проект: Easy Git.
- Автор/copyright: Copyright (c) 2026 Saiki77.
- URL: https://github.com/Saiki77/Easy-Git
- Проверенный commit: `d9546b18dded3c0e903ee6363d794187b61994c1`.
- Лицензия: MIT.
- Этап 1: fail-closed backup principle; sync engine и реализация backup не переносились.

## CoNote Git

- Проект: Obsidian CoNote Git.
- Автор/copyright: Copyright (c) 2024 Maximilian Witte.
- URL: https://github.com/Maximilianwte/Obsidian_CoNote_Git
- Проверенный commit: `3ac1a7a13dcf49ed3a2bcc7b034df3a33f6dd5a7`.
- Лицензия: MIT.
- Этап 1: справочные идеи per-mapping queue и разделения dir/gitdir; код не переносился.

## GitFacil

- Проект: GitFacil.
- Автор/copyright: Copyright (c) 2026 Alex Lazo.
- URL: https://github.com/Alecwce/obsidian-git-facil
- Проверенный commit: `d6f4b26f0e4984bbf534c180ed7479063ba3b449`.
- Лицензия: MIT.
- Этап 1: справочный анализ простого argv execution; код не переносился.

## Build и test dependencies

Build/test packages не являются источниками Git domain implementation и не bundle в runtime plugin; `obsidian` externalized при build. Exact versions зафиксированы `package-lock.json`. License metadata проверена непосредственно в установленных package manifests 2026-08-21:

| Package | Version | License |
| --- | --- | --- |
| `@eslint/js` | 10.0.1 | MIT |
| `@types/node` | 26.2.0 | MIT |
| `dependency-cruiser` | 18.2.0 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `eslint` | 10.9.0 | MIT |
| `globals` | 17.11.0 | MIT |
| `obsidian` | 1.13.1 | MIT |
| `typescript-eslint` | 8.67.0 | MIT |
| `typescript` | 6.0.3 | Apache-2.0 |
| `vitest` | 4.1.11 | MIT |

Исходные license files сохраняются в соответствующих installed packages. Эти dev dependencies не копируются в source tree и не являются donor implementation.

## Приложение A: MIT License donor projects

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
