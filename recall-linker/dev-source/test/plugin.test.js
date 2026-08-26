"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class Plugin {}
class MarkdownRenderChild {}
class PluginSettingTab {}
class TFile {}
class TFolder {}
class MarkdownView {}
class Setting {}
class WidgetType {}
class RangeSetBuilder {
  add() {}
  finish() { return []; }
}

const obsidianMock = {
  MarkdownRenderChild,
  MarkdownView,
  Notice: class {},
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  getAllTags: () => [],
  getLinkpath: (value) => value
};
const viewMock = {
  Decoration: { none: [], set: () => [], widget: () => ({ range: () => ({}) }) },
  ViewPlugin: { define: () => ({}), fromClass: () => ({}) },
  WidgetType
};
const stateMock = { RangeSetBuilder };
const languageMock = { syntaxTree: () => ({ iterate() {} }) };
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  if (request === "@codemirror/view") return viewMock;
  if (request === "@codemirror/state") return stateMock;
  if (request === "@codemirror/language") return languageMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PluginModule = require("../main.js");
Module._load = originalLoad;
const PluginClass = PluginModule.default;
const api = PluginClass.__test;

function definition(id, term, sourcePath = "словарь.md") {
  return { id, kind: "definition", term, definition: "Текст", sourcePath, occurrence: 0 };
}

function list(id, term, listTerms, sourcePath = "словарь.md") {
  return { id, kind: "list", term, definition: listTerms.join("\n"), listTerms, sourcePath, occurrence: 0 };
}

test("словосочетание имеет приоритет над последним отдельным словом", () => {
  const phrase = new api.VirtualMatch(1, "Теория систем", 0, 14, [{ path: "phrase.md" }], false, false, api.DEFAULT_SETTINGS);
  const lastWord = new api.VirtualMatch(2, "систем", 7, 14, [{ path: "word.md" }], false, false, api.DEFAULT_SETTINGS);
  const result = api.VirtualMatch.filterOverlapping(api.VirtualMatch.sort([lastWord, phrase]), false);
  assert.deepEqual(result.map((match) => match.id), [1]);
});

test("исключённая папка распознаётся с вложенными путями", () => {
  assert.equal(api.isPathInDirectories("опыт/черновик.md", api.DEFAULT_SETTINGS.excludedDirectories), true);
  assert.equal(api.isPathInDirectories("знания/черновик.md", api.DEFAULT_SETTINGS.excludedDirectories), false);
});

test("определение становится целью ссылки повторения", () => {
  const card = definition("definition-1", "Термин");
  assert.deepEqual(api.getRecallCards([card]).map((item) => item.id), [card.id]);
});

test("перечень с двумя полноценными определениями становится целью", () => {
  const cards = [
    definition("d1", "Первый"),
    definition("d2", "Второй"),
    list("l1", "Перечень", ["Первый", "Второй", "Третий"])
  ];
  assert.equal(api.countFullDefinitionsForList(cards[2], cards), 2);
  assert.equal(api.getRecallCards(cards).some((card) => card.id === "l1"), true);
});

test("перечень с одним полноценным определением не становится целью", () => {
  const cards = [definition("d1", "Первый"), list("l1", "Перечень", ["Первый", "Только термин"])];
  assert.equal(api.countFullDefinitionsForList(cards[1], cards), 1);
  assert.equal(api.getRecallCards(cards).some((card) => card.id === "l1"), false);
});

test("перечень только с терминами без определений не становится целью", () => {
  const cards = [list("l1", "Перечень", ["Первый", "Второй"])];
  assert.equal(api.countFullDefinitionsForList(cards[0], cards), 0);
  assert.equal(api.getRecallCards(cards).length, 0);
});

test("стили не задают подчёркивание или цвет текста", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.equal(/text-decoration\s*:/u.test(css), false);
  assert.equal(/(^|[;{]\s*)color\s*:/mu.test(css), false);
});

test("открывается карточка с точным идентификатором", async () => {
  const opened = [];
  const card = definition("correct-card", "Термин");
  const app = {
    plugins: {
      getPlugin: (id) => id === "term-interval-review" ? {
        cards: [card],
        openCard: async (cardId) => opened.push(cardId)
      } : null
    }
  };
  assert.equal(await api.openRecallCard(app, card.id), true);
  assert.deepEqual(opened, [card.id]);
});

test("все текущие настройки Virtual Linker стали настройками по умолчанию", () => {
  const current = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data.json"), "utf8"));
  for (const [key, value] of Object.entries(current)) {
    assert.deepEqual(api.DEFAULT_SETTINGS[key], value, key);
  }
});
