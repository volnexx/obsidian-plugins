# Activity

`Activity` локально считает:

- активное время в Obsidian;
- активное время в каждой заметке Markdown;
- число переходов к каждой заметке;
- статистику отдельно по календарным дням и за всё время.

Данные хранятся в `data.json` самого плагина и никуда не отправляются.

## Как считается время

Общее время увеличивается, когда Obsidian находится на экране, окно активно и не превышен предел бездействия. По умолчанию предел равен 5 минутам. Значение `0` полностью отключает остановку из-за бездействия.

Время заметки получает только активная заметка Markdown. Время в настройках, графе, холсте и других панелях входит в общее время Obsidian, но не записывается ни одной заметке.

Открытие засчитывается при переходе к заметке, в том числе при переходе к той же заметке в другой панели. Повторные служебные события Obsidian для уже активной панели не увеличивают счётчик.

Переименование заметки переносит всю её историю на новый путь. После удаления заметки история остаётся в статистике и помечается в таблице как недоступная.

## Установка

Распаковать папку `activity` в:

```text
<хранилище>/.obsidian/plugins/
```

Затем включить `Activity` в разделе сторонних плагинов Obsidian.

## Доступ из других плагинов

```ts
import type { ActivityApi } from "./activity-api";

const activityPlugin = (this.app as any).plugins.plugins["activity"];
const activity = activityPlugin?.api as ActivityApi | undefined;

const sixMostOpened = activity?.getTopNotes({
  metric: "openCount",
  limit: 6,
});

const unsubscribe = activity?.subscribe((change) => {
  if (change.type === "open") {
    console.log("Открыта заметка", change.path);
  }
});

// В `onunload` зависимого плагина:
unsubscribe?.();
```

Если зависимый плагин загрузился раньше `Activity`, он может дождаться готовности без опроса по таймеру:

```ts
this.registerEvent(
  (this.app.workspace as any).on("activity:ready", (api: ActivityApi) => {
    const sixMostOpened = api.getTopNotes({ metric: "openCount", limit: 6 });
  }),
);
```

Программный интерфейс версии `1` описан в `activity-api.d.ts`. Основные методы: `getSnapshot`, `getDailyStats`, `getNoteStats`, `getTopNotes`, `getCurrentActivity`, `subscribe` и `flush`.
