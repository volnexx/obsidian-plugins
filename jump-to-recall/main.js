"use strict";

const { MarkdownView, Notice, Plugin, TFile } = require("obsidian");
const { Decoration, EditorView, ViewPlugin } = require("@codemirror/view");

const PRIORITY_RECALL_ID = "term-interval-review";
const JUMP_TO_LINK_ID = "mrj-jump-to-link";
const REVIEW_LINK_CLASS = "prl-review-link";
const DEFINITION_DELIMITER = "—";
const BOLD_PATTERN = /\*\*([^*\r\n]+?)\*\*/gu;
const HEADING_PATTERN = /^\s{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/u;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;

function splitLines(content) {
  const lines = [];
  let start = 0;
  for (let index = 0; index <= content.length; index += 1) {
    if (index !== content.length && content[index] !== "\n") continue;
    let end = index;
    if (end > start && content[end - 1] === "\r") end -= 1;
    lines.push({ text: content.slice(start, end), start, end });
    start = index + 1;
  }
  return lines;
}

function parseDefinitionsFromLine(line) {
  const definitions = [];
  for (const match of line.matchAll(BOLD_PATTERN)) {
    const content = match[1] ?? "";
    const delimiter = content.indexOf(DEFINITION_DELIMITER);
    if (delimiter <= 0) continue;
    const term = content.slice(0, delimiter).trim();
    const definition = content.slice(delimiter + DEFINITION_DELIMITER.length).trim();
    if (term.length === 0 || definition.length === 0) continue;
    definitions.push({
      term,
      definition,
      start: (match.index ?? 0) + 2,
      end: (match.index ?? 0) + 2 + content.length
    });
  }
  return definitions;
}

function parseListTermsFromLine(line) {
  const terms = [];
  for (const match of line.matchAll(BOLD_PATTERN)) {
    const content = (match[1] ?? "").trim();
    if (content.length === 0) continue;
    const delimiter = content.indexOf(DEFINITION_DELIMITER);
    if (delimiter === -1) {
      terms.push(content);
      continue;
    }
    if (delimiter <= 0) continue;
    const term = content.slice(0, delimiter).trim();
    const definition = content.slice(delimiter + DEFINITION_DELIMITER.length).trim();
    if (term.length > 0 && definition.length > 0) terms.push(term);
  }
  return terms;
}

function parseRenderedDefinition(text) {
  const content = String(text ?? "").trim();
  const delimiter = content.indexOf(DEFINITION_DELIMITER);
  if (delimiter <= 0) return null;
  const term = content.slice(0, delimiter).trim();
  const definition = content.slice(delimiter + DEFINITION_DELIMITER.length).trim();
  return term.length > 0 && definition.length > 0 ? { term, definition } : null;
}

function getHeadingRange(line, capturedTitle) {
  const captureStart = line.indexOf(capturedTitle);
  const withoutClosingHashes = capturedTitle.replace(/[ \t]+#+[ \t]*$/u, "");
  const leadingWhitespace = withoutClosingHashes.length - withoutClosingHashes.trimStart().length;
  const title = withoutClosingHashes.trim();
  return {
    title,
    start: Math.max(0, captureStart) + leadingWhitespace,
    end: Math.max(0, captureStart) + leadingWhitespace + title.length
  };
}

function parseReviewTargets(content) {
  const lines = splitLines(content);
  const targets = [];
  const definitionOccurrences = new Map();
  const listOccurrences = new Map();
  let inFrontmatter = lines[0]?.text.trim() === "---";
  let fenceCharacter = null;
  let fenceLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();
    if (inFrontmatter) {
      if (index > 0 && (trimmed === "---" || trimmed === "...")) inFrontmatter = false;
      continue;
    }

    const fence = line.text.match(FENCE_PATTERN)?.[1];
    if (fence) {
      const character = fence[0];
      if (fenceCharacter === null) {
        fenceCharacter = character;
        fenceLength = fence.length;
      } else if (character === fenceCharacter && fence.length >= fenceLength) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter !== null) continue;

    for (const definition of parseDefinitionsFromLine(line.text)) {
      const occurrence = definitionOccurrences.get(definition.term) ?? 0;
      definitionOccurrences.set(definition.term, occurrence + 1);
      targets.push({
        kind: "definition",
        term: definition.term,
        occurrence,
        line: index,
        from: line.start + definition.start,
        to: line.start + definition.end
      });
    }

    const headingMatch = line.text.match(HEADING_PATTERN);
    if (!headingMatch) continue;
    const heading = getHeadingRange(line.text, headingMatch[1] ?? "");
    if (heading.title.length === 0) continue;
    const occurrence = listOccurrences.get(heading.title) ?? 0;
    listOccurrences.set(heading.title, occurrence + 1);

    let termIndex = index + 1;
    let lineTerms = parseListTermsFromLine(lines[termIndex]?.text ?? "");
    if (lineTerms.length === 0) continue;
    const terms = [...lineTerms];
    while (termIndex + 1 < lines.length) {
      let candidateIndex = termIndex + 1;
      if ((lines[candidateIndex]?.text ?? "").trim().length === 0) {
        candidateIndex += 1;
        if ((lines[candidateIndex]?.text ?? "").trim().length === 0) break;
      }
      lineTerms = parseListTermsFromLine(lines[candidateIndex]?.text ?? "");
      if (lineTerms.length === 0) break;
      terms.push(...lineTerms);
      termIndex = candidateIndex;
    }
    if (terms.length < 2) continue;
    targets.push({
      kind: "list",
      term: heading.title,
      occurrence,
      line: index,
      from: line.start + heading.start,
      to: line.start + heading.end
    });
  }

  return targets.sort((left, right) => left.from - right.from || left.to - right.to);
}

function getCardKind(card) {
  return card?.kind === "list" || Array.isArray(card?.listTerms) ? "list" : "definition";
}

function normalizeStoredTerm(term) {
  return String(term ?? "")
    .replaceAll("**", "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, "")
    .trim();
}

function getHintLetters(alphabet, count) {
  const characters = [...new Set(Array.from(String(alphabet || "sadfjklewcmpgh").toUpperCase()))];
  if (characters.length < 2) characters.push("A", "S");
  let prefixCount = Math.ceil((count - characters.length) / (characters.length - 1));
  prefixCount = Math.max(0, Math.min(prefixCount, characters.length));
  const prefixes = ["", ...characters.slice(0, prefixCount)];
  const reserved = new Set(prefixes.slice(1));
  const result = [];
  for (const prefix of prefixes) {
    for (const character of characters) {
      if (result.length >= count) return result;
      if (prefix === "" && reserved.has(character)) continue;
      result.push(prefix + character);
    }
  }
  return result;
}

function targetAttributes(target, sourcePath = "") {
  const identity = `${target.kind}:${target.occurrence}:${target.term}`;
  return {
    href: `#priority-recall-${encodeURIComponent(identity)}`,
    class: `internal-link ${REVIEW_LINK_CLASS}`,
    "data-href": `priority-recall:${identity}`,
    "data-prl-kind": target.kind,
    "data-prl-term": target.term,
    "data-prl-occurrence": String(target.occurrence),
    "data-prl-source": sourcePath,
    "aria-label": `Открыть карточку повторения: ${target.term}`,
    draggable: "false"
  };
}

function targetFromElement(element) {
  const occurrence = Number(element.dataset.prlOccurrence);
  const kind = element.dataset.prlKind;
  const term = element.dataset.prlTerm;
  if ((kind !== "definition" && kind !== "list") || !term || !Number.isInteger(occurrence) || occurrence < 0) {
    return null;
  }
  return {
    kind,
    term,
    occurrence,
    sourcePath: element.dataset.prlSource || ""
  };
}

class RecallDecorationView {
  constructor(view) {
    this.decorations = this.build(view);
  }

  update(update) {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.decorations = this.build(update.view);
    }
  }

  build(editorView) {
    const targets = parseReviewTargets(editorView.state.doc.toString());
    const ranges = targets.map((target) => {
      const attributes = targetAttributes(target);
      const className = attributes.class;
      delete attributes.class;
      return Decoration.mark({
        tagName: "a",
        class: className,
        attributes
      }).range(target.from, target.to);
    });
    return Decoration.set(ranges, true);
  }
}

class JumpToRecallPlugin extends Plugin {
  async onload() {
    this.jumpPatch = null;
    this.editorExtension = ViewPlugin.fromClass(RecallDecorationView, {
      decorations: (value) => value.decorations
    });

    const clickHandler = EditorView.domEventHandlers({
      click: (event, editorView) => {
        const element = typeof event.target?.closest === "function"
          ? event.target.closest(`a.${REVIEW_LINK_CLASS}`)
          : null;
        if (!element) return false;
        event.preventDefault();
        event.stopPropagation();
        void this.openElementTarget(element, this.getSourcePathForEditor(editorView));
        return true;
      }
    });

    this.registerEditorExtension([this.editorExtension, clickHandler]);
    this.registerMarkdownPostProcessor((element, context) => this.decorateRenderedMarkdown(element, context));

    this.app.workspace.onLayoutReady(() => this.patchJumpToLink());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.patchJumpToLink()));
    this.registerInterval(window.setInterval(() => this.patchJumpToLink(), 2_000));
    this.register(() => this.restoreJumpToLink());
  }

  onunload() {
    this.restoreJumpToLink();
  }

  getPriorityRecall() {
    return this.app.plugins?.getPlugin?.(PRIORITY_RECALL_ID) ?? null;
  }

  getSourcePathForEditor(editorView) {
    let path = "";
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (path || !(leaf.view instanceof MarkdownView)) return;
      if (leaf.view.editor?.cm === editorView) path = leaf.view.file?.path ?? "";
    });
    return path || this.app.workspace.getActiveFile()?.path || "";
  }

  findCard(priorityRecall, target) {
    const cards = Array.isArray(priorityRecall?.cards) ? priorityRecall.cards : [];
    return cards.find((card) =>
      card.sourcePath === target.sourcePath
      && getCardKind(card) === target.kind
      && normalizeStoredTerm(card.term) === normalizeStoredTerm(target.term)
      && Number(card.occurrence ?? 0) === target.occurrence
    ) ?? null;
  }

  async openTarget(target) {
    const priorityRecall = this.getPriorityRecall();
    if (!priorityRecall || typeof priorityRecall.openCard !== "function") {
      new Notice("Включите плагин «Повторение терминов», чтобы открыть карточку.");
      return;
    }
    if (!target.sourcePath) {
      new Notice("Не удалось определить исходную заметку карточки.");
      return;
    }

    let card = this.findCard(priorityRecall, target);
    if (!card && typeof priorityRecall.synchronizeFile === "function") {
      const file = this.app.vault.getAbstractFileByPath(target.sourcePath);
      if (file instanceof TFile && file.extension === "md") {
        await priorityRecall.synchronizeFile(file, true, true);
        card = this.findCard(priorityRecall, target);
      }
    }
    if (!card) {
      new Notice(`Карточка «${target.term}» ещё не создана. Сохраните заметку и повторите переход.`);
      return;
    }
    await priorityRecall.openCard(card.id);
  }

  async openElementTarget(element, fallbackSourcePath = "") {
    const target = targetFromElement(element);
    if (!target) return;
    if (!target.sourcePath) target.sourcePath = fallbackSourcePath;
    await this.openTarget(target);
  }

  makeRenderedLink(document, target, sourcePath) {
    const anchor = document.createElement("a");
    for (const [name, value] of Object.entries(targetAttributes(target, sourcePath))) {
      if (name === "class") anchor.className = value;
      else anchor.setAttribute(name, value);
    }
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void this.openElementTarget(anchor, sourcePath);
    });
    return anchor;
  }

  wrapInlineElement(element, target, sourcePath) {
    if (element.closest(`a.${REVIEW_LINK_CLASS}`) || element.querySelector("a")) return;
    const anchor = this.makeRenderedLink(element.ownerDocument, target, sourcePath);
    element.replaceWith(anchor);
    anchor.append(element);
  }

  wrapHeadingContents(heading, target, sourcePath) {
    if (heading.querySelector("a")) return;
    const anchor = this.makeRenderedLink(heading.ownerDocument, target, sourcePath);
    while (heading.firstChild) anchor.append(heading.firstChild);
    heading.append(anchor);
  }

  async decorateRenderedMarkdown(element, context) {
    const sourcePath = context.sourcePath;
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile) || file.extension !== "md") return;
    const section = context.getSectionInfo?.(element);

    let content;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (error) {
      console.error(`Не удалось подготовить ссылки повторения для ${sourcePath}`, error);
      return;
    }
    const lineStart = section?.lineStart ?? 0;
    const lineEnd = section?.lineEnd ?? Number.POSITIVE_INFINITY;
    const targets = parseReviewTargets(content).filter((target) => target.line >= lineStart && target.line <= lineEnd);

    const definitionTargets = targets.filter((target) => target.kind === "definition");
    const strongElements = [...element.querySelectorAll("strong")].filter((strong) =>
      parseRenderedDefinition(strong.textContent) !== null
      && !strong.closest(`a.${REVIEW_LINK_CLASS}`)
    );
    const usedStrong = new Set();
    for (const target of definitionTargets) {
      const strong = strongElements.find((candidate) => {
        if (usedStrong.has(candidate)) return false;
        return parseRenderedDefinition(candidate.textContent)?.term === target.term;
      });
      if (!strong) continue;
      usedStrong.add(strong);
      this.wrapInlineElement(strong, target, sourcePath);
    }

    const listTargets = targets.filter((target) => target.kind === "list");
    const headings = [...element.querySelectorAll("h1, h2, h3, h4, h5, h6")];
    const usedHeadings = new Set();
    for (const target of listTargets) {
      const heading = headings.find((candidate) =>
        !usedHeadings.has(candidate)
        && normalizeStoredTerm((candidate.textContent ?? "").replace(/[ \t]+#+[ \t]*$/u, "").trim())
          === normalizeStoredTerm(target.term)
      );
      if (!heading) continue;
      usedHeadings.add(heading);
      this.wrapHeadingContents(heading, target, sourcePath);
    }
  }

  getSourceModeReviewHints(jumpPlugin) {
    const editor = jumpPlugin.cmEditor;
    const document = editor?.state?.doc;
    if (!document) return [];
    const sourcePath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path
      ?? this.app.workspace.getActiveFile()?.path
      ?? "";
    const from = editor.viewport?.from ?? 0;
    const to = editor.viewport?.to ?? document.length;
    return parseReviewTargets(document.toString())
      .filter((target) => target.to >= from && target.from <= to)
      .map((target) => ({
        index: target.from,
        type: "priority-recall",
        linkText: target.term,
        reviewTarget: { ...target, sourcePath },
        letter: ""
      }));
  }

  patchJumpToLink() {
    const jumpPlugin = this.app.plugins?.getPlugin?.(JUMP_TO_LINK_ID);
    if (!jumpPlugin || typeof jumpPlugin.handleActions !== "function" || typeof jumpPlugin.handleHotkey !== "function") {
      if (this.jumpPatch && this.jumpPatch.plugin !== jumpPlugin) this.restoreJumpToLink();
      return;
    }
    if (this.jumpPatch?.plugin === jumpPlugin) return;
    this.restoreJumpToLink();

    const originalHandleActions = jumpPlugin.handleActions;
    const originalHandleHotkey = jumpPlugin.handleHotkey;
    const bridge = this;

    function patchedHandleHotkey(heldShiftKey, link) {
      if (link?.type === "priority-recall" && link.reviewTarget) {
        void bridge.openTarget(link.reviewTarget);
        return;
      }
      return originalHandleHotkey.call(this, heldShiftKey, link);
    }

    function patchedHandleActions(linkHints, linkHintHtmlElements) {
      if (this.mode !== 0) return originalHandleActions.call(this, linkHints, linkHintHtmlElements);
      const reviewHints = bridge.getSourceModeReviewHints(this);
      if (reviewHints.length === 0) return originalHandleActions.call(this, linkHints, linkHintHtmlElements);

      const combined = [...linkHints, ...reviewHints].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
      const letters = getHintLetters(this.settings?.letters, combined.length);
      combined.forEach((hint, index) => {
        hint.letter = letters[index] ?? "";
      });
      const visible = combined.filter((hint) => hint.letter);
      try {
        const marker = this.cmEditor?.plugin?.(this.markViewPlugin);
        marker?.setLinks?.(visible);
        bridge.app.workspace.updateOptions();
      } catch (error) {
        console.error("Не удалось добавить подсказки карточек в Jump to Link", error);
      }
      return originalHandleActions.call(this, visible, linkHintHtmlElements);
    }

    jumpPlugin.handleHotkey = patchedHandleHotkey;
    jumpPlugin.handleActions = patchedHandleActions;
    this.jumpPatch = {
      plugin: jumpPlugin,
      originalHandleActions,
      originalHandleHotkey,
      patchedHandleActions,
      patchedHandleHotkey
    };
  }

  restoreJumpToLink() {
    const patch = this.jumpPatch;
    if (!patch) return;
    if (patch.plugin.handleActions === patch.patchedHandleActions) {
      patch.plugin.handleActions = patch.originalHandleActions;
    }
    if (patch.plugin.handleHotkey === patch.patchedHandleHotkey) {
      patch.plugin.handleHotkey = patch.originalHandleHotkey;
    }
    this.jumpPatch = null;
  }
}

JumpToRecallPlugin.__test = {
  getHintLetters,
  parseReviewTargets,
  parseDefinitionsFromLine,
  parseListTermsFromLine
};

module.exports = JumpToRecallPlugin;
