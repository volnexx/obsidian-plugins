"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class Plugin {}
class MarkdownRenderChild { constructor() {} load() {} }
class PluginSettingTab {}
class TFile {
  constructor(filePath) {
    this.path = filePath;
    this.basename = path.basename(filePath, path.extname(filePath));
    this.extension = path.extname(filePath).slice(1);
    this.stat = { mtime: 1 };
  }
}
class TFolder {}
class Notice { constructor(message) { Notice.messages.push(message); } }
Notice.messages = [];
class Setting {
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addTextArea() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
}

const obsidianMock = {
  MarkdownRenderChild,
  MarkdownView: class {},
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  getAllTags(cache) { return cache?.tags ?? []; },
  getLinkpath(value) { return value; }
};
class RangeSetBuilder { add() {} finish() { return []; } }
class WidgetType {}
const codeMirrorViewMock = {
  Decoration: { widget() { return {}; } },
  ViewPlugin: { define(factory) { return factory; } },
  WidgetType
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  if (request === "@codemirror/language") return { syntaxTree() { return { iterate() {} }; } };
  if (request === "@codemirror/state") return { RangeSetBuilder };
  if (request === "@codemirror/view") return codeMirrorViewMock;
  return originalLoad.call(this, request, parent, isMain);
};
const exported = require("../main.js");
Module._load = originalLoad;
const PluginClass = exported.default ?? exported;
const { PrefixTree, ReviewTarget, VirtualMatch, getEligibleReviewCards } = PluginClass.__test;

const settings = {
  includeAllFiles: true,
  linkerDirectories: [],
  excludedDirectories: ["опыт"],
  excludedDirectoriesForLinking: [],
  tagToIncludeFile: "linker-include",
  tagToExcludeFile: "linker-exclude",
  tagToIgnoreCase: "linker-ignore-case",
  tagToMatchCase: "linker-match-case",
  propertyNameToMatchCase: "linker-match-case",
  propertyNameToIgnoreCase: "linker-ignore-case",
  includeAliases: true,
  matchCaseSensitive: false,
  capitalLetterProportionForAutomaticMatchCase: 0.75,
  excludeLinksToOwnNote: false,
  matchAnyPartsOfWords: false,
  matchBeginningOfWords: false,
  matchEndOfWords: false,
  virtualLinkSuffix: "✧",
  virtualLinkAliasSuffix: "✧",
  suppressSuffixForSubWords: false,
  alwaysShowMultipleReferences: false
};

function createApp(filePaths, cards = [], aliases = {}) {
  const files = filePaths.map((filePath) => new TFile(filePath));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const reviewPlugin = {
    cards,
    opened: [],
    async openCard(cardId) { this.opened.push(cardId); }
  };
  return {
    app: {
      metadataCache: {
        getFileCache(file) { return { frontmatter: { aliases: aliases[file.path] ?? [] }, tags: [] }; }
      },
      plugins: { getPlugin(id) { return id === "term-interval-review" ? reviewPlugin : null; } },
      vault: {
        getAbstractFileByPath(filePath) { return byPath.get(filePath) ?? null; },
        getFileByPath(filePath) { return byPath.get(filePath) ?? null; },
        getMarkdownFiles() { return files; }
      },
      workspace: { getActiveFile() { return null; } }
    },
    files,
    reviewPlugin
  };
}

function scan(tree, text) {
  tree.resetSearch();
  const matches = [];
  let id = 0;
  for (let index = 0; index <= text.length;) {
    const character = index < text.length ? String.fromCodePoint(text.codePointAt(index)) : "\n";
    const boundary = PrefixTree.checkWordBoundary(character);
    if (tree.settings.matchAnyPartsOfWords || tree.settings.matchBeginningOfWords || boundary) {
      for (const node of tree.getCurrentMatchNodes(index, null)) {
        matches.push(new VirtualMatch(id++, text.slice(node.start, node.end), node.start, node.end, [...node.files], node.isAlias, !boundary, tree.settings));
      }
    }
    tree.pushChar(character);
    index += character.length;
  }
  return VirtualMatch.filterOverlapping(VirtualMatch.sort(matches), false);
}

function definition(id, term, sourcePath = "source.md", occurrence = 0) {
  return { id, kind: "definition", term, sourcePath, occurrence };
}

function list(id, term, listTerms, definitionRefs, sourcePath = "source.md") {
  return { id, kind: "list", term, listTerms, definitionRefs, sourcePath, occurrence: 0 };
}

test("обычное название заметки остаётся виртуальной ссылкой", () => {
  const { app, files } = createApp(["Обычная заметка.md"]);
  const matches = scan(new PrefixTree(app, settings), "Обычная заметка находится здесь");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].files[0], files[0]);
});

test("термин определения становится целью и открывает точную карточку", async () => {
  const card = definition("definition-id", "Точный термин");
  const { app, reviewPlugin } = createApp(["source.md"], [card]);
  const match = scan(new PrefixTree(app, settings), "Точный термин встречается в тексте")[0];
  assert.equal(match.files[0].cardId, "definition-id");
  await match.files[0].open();
  assert.deepEqual(reviewPlugin.opened, ["definition-id"]);
});

test("заголовок перечня с двумя полноценными определениями становится ссылкой", () => {
  const cards = [
    definition("a", "Первый"),
    definition("b", "Второй"),
    list("list", "Полный перечень", ["Первый", "Второй"], [
      { term: "Первый", occurrence: 0 },
      { term: "Второй", occurrence: 0 }
    ])
  ];
  assert.equal(getEligibleReviewCards(cards).some((card) => card.id === "list"), true);
});

test("перечень с одним полноценным определением не становится ссылкой", () => {
  const cards = [
    definition("a", "Первый"),
    list("list", "Неполный перечень", ["Первый", "Без определения"], [
      { term: "Первый", occurrence: 0 }
    ])
  ];
  assert.equal(getEligibleReviewCards(cards).some((card) => card.id === "list"), false);
});

test("перечень только с жирными терминами без определений не становится ссылкой", () => {
  const cards = [list("list", "Только жирные", ["Первый", "Второй"], [])];
  assert.equal(getEligibleReviewCards(cards).some((card) => card.id === "list"), false);
});

test("приоритет наиболее длинного словосочетания сохраняется", () => {
  const { app } = createApp(["термин.md", "длинный термин.md"]);
  const matches = scan(new PrefixTree(app, settings), "длинный термин встречается");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].originText, "длинный термин");
});

test("при конфликте названия заметки и термина приоритет у карточки", () => {
  const card = definition("definition-id", "Конфликт", "source.md");
  const { app } = createApp(["Конфликт.md", "source.md"], [card]);
  const match = scan(new PrefixTree(app, settings), "Конфликт обнаружен")[0];
  assert.equal(match.files.length, 1);
  assert.equal(match.files[0].cardId, "definition-id");
});

test("исключённая папка опыт продолжает исключаться", () => {
  const card = definition("excluded-definition", "Скрытый термин", "опыт/source.md");
  const { app } = createApp(["опыт/Скрытая заметка.md", "опыт/source.md"], [card]);
  const tree = new PrefixTree(app, settings);
  assert.equal(scan(tree, "Скрытая заметка и Скрытый термин").length, 0);
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach((name) => this.classList.values.add(name)),
      contains: (name) => this.classList.values.has(name)
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  hasChildNodes() { return this.children.length > 0; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  dispatchEvent(event) { this.listeners.get(event.type)?.(event); return true; }
  querySelectorAll(selector) {
    const result = [];
    const visit = (element) => {
      if (selector === "a, .metadata-link-inner" && (element.tagName === "A" || element.classList.contains("metadata-link-inner"))) result.push(element);
      element.children.forEach(visit);
    };
    visit(this);
    return result;
  }
}

test("оформление не задаёт цвет или text-decoration", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.doesNotMatch(css, /(?:^|[;{])\s*color\s*:/imu);
  assert.doesNotMatch(css, /text-decoration\s*:/imu);
});

test("Jump to Link обнаруживает стандартный anchor и его click открывает карточку", async () => {
  const card = definition("jump-card-id", "Переход");
  const { app, reviewPlugin } = createApp(["source.md"], [card]);
  const target = new ReviewTarget(app, card);
  const previousDocument = global.document;
  global.document = { createElement(tagName) { return new FakeElement(tagName); } };
  try {
    const match = new VirtualMatch(0, "Переход", 0, 7, [target], false, false, settings);
    const root = match.getCompleteLinkElement();
    const discovered = root.querySelectorAll("a, .metadata-link-inner");
    assert.equal(discovered.length, 1);
    const anchor = discovered[0];
    assert.equal(anchor.classList.contains("internal-link"), true);
    assert.equal(anchor.classList.contains("virtual-link-a"), true);
    assert.equal(anchor.getAttribute("data-vl-review-card-id"), "jump-card-id");
    anchor.dispatchEvent({ type: "click", preventDefault() {}, stopPropagation() {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(reviewPlugin.opened, ["jump-card-id"]);
  } finally {
    global.document = previousDocument;
  }
});
