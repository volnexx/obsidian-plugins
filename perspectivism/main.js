"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PerspectivismPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/core.ts
var MARKER = "ppp";
var SCAN_DIRECTIVE = "scan on";
var LEGACY_RESULTS_START = "<!-- nnn-results:start -->";
var LEGACY_RESULTS_END = "<!-- nnn-results:end -->";
function createMinimalTextChange(current, updated) {
  if (current === updated) return null;
  let fromOffset = 0;
  const sharedLength = Math.min(current.length, updated.length);
  while (fromOffset < sharedLength && current[fromOffset] === updated[fromOffset]) {
    fromOffset += 1;
  }
  let currentEnd = current.length;
  let updatedEnd = updated.length;
  while (currentEnd > fromOffset && updatedEnd > fromOffset && current[currentEnd - 1] === updated[updatedEnd - 1]) {
    currentEnd -= 1;
    updatedEnd -= 1;
  }
  return {
    fromOffset,
    toOffset: currentEnd,
    replacement: updated.slice(fromOffset, updatedEnd)
  };
}
function mapOffsetThroughTextChange(offset, change) {
  if (offset < change.fromOffset) return offset;
  if (offset >= change.toOffset) {
    return offset + change.replacement.length - (change.toOffset - change.fromOffset);
  }
  return change.fromOffset + Math.min(offset - change.fromOffset, change.replacement.length);
}
function normalizedNoteName(value) {
  const trimmed = value.trim();
  const withoutExtension = trimmed.toLocaleLowerCase().endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
  return withoutExtension.toLocaleLowerCase();
}
function parseExcludedNoteNames(value) {
  const seen = /* @__PURE__ */ new Set();
  const names = [];
  for (const line of normalizedLines(value)) {
    const name = normalizedNoteName(line);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
function isExcludedNotePath(sourcePath, excludedNoteNames) {
  const sourceName = normalizedNoteName(sourceTitleFromPath(sourcePath));
  return excludedNoteNames.includes(sourceName);
}
function parseExcludedTitleKeywords(value) {
  return uniqueKeywords(normalizedLines(value));
}
function titleContainsExcludedKeyword(sourcePath, excludedTitleKeywords) {
  const sourceTitle = sourceTitleFromPath(sourcePath);
  return excludedTitleKeywords.some(
    (keyword) => lineContainsKeyword(sourceTitle, keyword)
  );
}
function isObsidianConfigPath(sourcePath, configDir = ".obsidian") {
  const normalizedPath = sourcePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const normalizedConfigDir = configDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedConfigDir) return false;
  return normalizedPath === normalizedConfigDir || normalizedPath.startsWith(`${normalizedConfigDir}/`);
}
function sourceTitleFromPath(sourcePath) {
  const fileName = sourcePath.split("/").pop() ?? sourcePath;
  return fileName.toLocaleLowerCase().endsWith(".md") ? fileName.slice(0, -3) : fileName;
}
function formatCollectedLine(line, lineTemplate = "p") {
  const sourcedText = `${sourceTitleFromPath(line.sourcePath)} \u2013 ${line.text}`;
  return lineTemplate.includes("p") ? lineTemplate.split("p").join(sourcedText) : sourcedText;
}
function formatUniqueCollectedLines(lines, lineTemplate = "p") {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const line of lines) {
    const formatted = formatCollectedLine(line, lineTemplate);
    const identity = formatted.trim().toLocaleLowerCase();
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(formatted);
  }
  return result;
}
function normalizedLines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
function uniqueKeywords(lines) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const line of lines) {
    const keyword = line.trim();
    if (!keyword) continue;
    const identity = keyword.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(keyword);
  }
  return result;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function lineContainsKeyword(line, keyword) {
  const needle = keyword.trim();
  if (!needle) return false;
  const wordCharacter = String.raw`\p{L}\p{M}\p{N}_`;
  const pattern = new RegExp(
    `(?<![${wordCharacter}])${escapeRegExp(needle)}(?![${wordCharacter}])`,
    "iu"
  );
  return pattern.test(line);
}
function findKeywordBlock(text) {
  const lines = normalizedLines(text);
  for (let start = 0; start < lines.length; start += 1) {
    if (lines[start].trim().toLocaleLowerCase() !== MARKER) continue;
    let end = start + 1;
    while (end < lines.length && lines[end].trim().length > 0) end += 1;
    const scanDirectiveLine = start + 2;
    const scanEnabled = lines[scanDirectiveLine]?.trim().toLocaleLowerCase() === SCAN_DIRECTIVE;
    const keywordStart = scanEnabled ? start + 3 : start + 2;
    return {
      startLine: start,
      endLine: end - 1,
      lineTemplate: lines[start + 1] ?? "",
      scanEnabled,
      keywords: uniqueKeywords(lines.slice(keywordStart, end)),
      rawLines: lines.slice(start, end)
    };
  }
  return null;
}
function removeLegacyGeneratedResults(text) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = normalizedLines(text);
  const output = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === LEGACY_RESULTS_START) {
      inside = true;
      continue;
    }
    if (inside && line.trim() === LEGACY_RESULTS_END) {
      inside = false;
      continue;
    }
    if (!inside) output.push(line);
  }
  return output.join(newline);
}
function joinNormalizedLines(lines, newline, keepFinalNewline) {
  let result = lines.join(newline);
  if (keepFinalNewline) result += newline;
  return result;
}
function removeKnownGeneratedLinesAnywhere(text, generatedLines = [], removeEveryKnownOccurrence = false) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const keepFinalNewline = /(?:\r\n|\r|\n)$/.test(text);
  const withoutLegacyResults = removeLegacyGeneratedResults(text);
  if (generatedLines.length === 0) {
    return {
      cleanedText: withoutLegacyResults,
      removedCount: 0,
      complete: true
    };
  }
  const block = findKeywordBlock(withoutLegacyResults);
  if (!block) {
    return {
      cleanedText: withoutLegacyResults,
      removedCount: 0,
      complete: false
    };
  }
  const lines = normalizedLines(withoutLegacyResults);
  if (keepFinalNewline && lines[lines.length - 1] === "") lines.pop();
  const remaining = /* @__PURE__ */ new Map();
  for (const line of generatedLines) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  const known = new Set(remaining.keys());
  const output = [];
  let removedCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const belongsToBlock = index >= block.startLine && index <= block.endLine;
    const remainingCount = remaining.get(line) ?? 0;
    const shouldRemove = !belongsToBlock && (removeEveryKnownOccurrence ? known.has(line) : remainingCount > 0);
    if (!shouldRemove) {
      output.push(line);
      continue;
    }
    removedCount += 1;
    if (!removeEveryKnownOccurrence) {
      if (remainingCount === 1) remaining.delete(line);
      else remaining.set(line, remainingCount - 1);
    }
  }
  return {
    cleanedText: joinNormalizedLines(output, newline, keepFinalNewline),
    removedCount,
    complete: removeEveryKnownOccurrence ? removedCount > 0 : remaining.size === 0
  };
}
function collectMatchingLines(text, keywords, sourcePath, generatedLines = []) {
  if (keywords.length === 0) return [];
  const cleanText = removeKnownGeneratedLinesAnywhere(
    text,
    generatedLines
  ).cleanedText;
  const block = findKeywordBlock(cleanText);
  const lines = normalizedLines(cleanText);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (block && index >= block.startLine && index <= block.endLine) continue;
    const line = lines[index];
    if (!line.trim()) continue;
    if (!keywords.some((keyword) => lineContainsKeyword(line, keyword))) continue;
    matches.push({ text: line, sourcePath, lineNumber: index + 1 });
  }
  return matches;
}
function replaceGeneratedResults(text, resultLines, previousResultLines = []) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const keepFinalNewline = /(?:\r\n|\r|\n)$/.test(text);
  const generatedCandidates = Array.from(
    /* @__PURE__ */ new Set([...previousResultLines, ...resultLines])
  );
  const removal = removeKnownGeneratedLinesAnywhere(
    text,
    generatedCandidates,
    true
  );
  const cleanText = removal.cleanedText;
  const block = findKeywordBlock(cleanText);
  if (!block) throw new Error("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0441\u043F\u0438\u0441\u043E\u043A \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432, \u043D\u0430\u0447\u0438\u043D\u0430\u044E\u0449\u0438\u0439\u0441\u044F \u0441\u043E \u0441\u0442\u0440\u043E\u043A\u0438 ppp.");
  const lines = normalizedLines(cleanText);
  if (keepFinalNewline && lines[lines.length - 1] === "") lines.pop();
  const before = lines.slice(0, block.startLine);
  while (before.length > 0 && before[before.length - 1] === "") before.pop();
  const after = lines.slice(block.startLine);
  const output = [...before];
  if (resultLines.length > 0) {
    if (output.length > 0) output.push("");
    output.push(...resultLines);
  }
  if (output.length > 0) output.push("");
  output.push(...after);
  let result = output.join(newline);
  if (keepFinalNewline) result += newline;
  return result;
}
function frontmatterEnd(lines) {
  if (lines[0]?.trim() !== "---") return -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") return index;
  }
  return -1;
}
function noteContentLines(text) {
  const block = findKeywordBlock(text);
  const lines = normalizedLines(text);
  const yamlEnd = frontmatterEnd(lines);
  const content = [];
  for (let index = 0; index < lines.length; index += 1) {
    const belongsToBlock = block !== null && index >= block.startLine && index <= block.endLine;
    const belongsToFrontmatter = yamlEnd >= 0 && index <= yamlEnd;
    if (belongsToBlock || belongsToFrontmatter) continue;
    const line = lines[index];
    if (line.trim().length > 0) content.push(line);
  }
  return content;
}
function countPerspectiveLines(text, perspectives) {
  const content = noteContentLines(text);
  return uniqueKeywords(perspectives).map((perspective) => ({
    perspective,
    lineCount: content.filter((line) => lineContainsKeyword(line, perspective)).length
  }));
}
function collectPerspectiveReviewLines(text, perspectives, generatedLines = [], skipLinesWithAnySelectedPerspective = true) {
  const block = findKeywordBlock(text);
  if (!block) {
    throw new Error("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0441\u043F\u0438\u0441\u043E\u043A \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432, \u043D\u0430\u0447\u0438\u043D\u0430\u044E\u0449\u0438\u0439\u0441\u044F \u0441\u043E \u0441\u0442\u0440\u043E\u043A\u0438 ppp.");
  }
  const selectedPerspectives = uniqueKeywords(perspectives);
  if (selectedPerspectives.length === 0) {
    throw new Error("\u041D\u0443\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0443.");
  }
  const lines = normalizedLines(text);
  const yamlEnd = frontmatterEnd(lines);
  const generatedLineSet = new Set(generatedLines);
  const queue = [];
  for (let index = 0; index < lines.length; index += 1) {
    const belongsToBlock = index >= block.startLine && index <= block.endLine;
    const belongsToFrontmatter = yamlEnd >= 0 && index <= yamlEnd;
    const line = lines[index];
    if (belongsToBlock || belongsToFrontmatter || line.trim().length === 0 || generatedLineSet.has(line)) {
      continue;
    }
    const presentPerspectives = selectedPerspectives.filter(
      (perspective) => lineContainsKeyword(line, perspective)
    );
    if (skipLinesWithAnySelectedPerspective && presentPerspectives.length > 0) {
      continue;
    }
    const presentIdentities = new Set(
      presentPerspectives.map((perspective) => perspective.toLocaleLowerCase())
    );
    const missingPerspectives = selectedPerspectives.filter(
      (perspective) => !presentIdentities.has(perspective.toLocaleLowerCase())
    );
    if (missingPerspectives.length === 0) continue;
    queue.push({
      lineNumber: index,
      text: line,
      presentPerspectives,
      missingPerspectives
    });
  }
  return queue;
}
function perspectivesForReviewDirection(perspectives, direction, additionalPerspectives = []) {
  const selectedPerspectives = uniqueKeywords(perspectives);
  if (selectedPerspectives.length === 0 || selectedPerspectives.length > 2) {
    throw new Error(
      "\u041F\u0435\u0440\u0435\u043B\u0438\u0441\u0442\u044B\u0432\u0430\u043D\u0438\u0435 \u0441\u0442\u0440\u0435\u043B\u043A\u0430\u043C\u0438 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0441 \u043E\u0434\u043D\u043E\u0439 \u0438\u043B\u0438 \u0434\u0432\u0443\u043C\u044F \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430\u043C\u0438."
    );
  }
  if (direction === "up") return [];
  if (selectedPerspectives.length === 1) {
    return direction === "right" ? uniqueKeywords([
      selectedPerspectives[0],
      ...additionalPerspectives
    ]) : [];
  }
  const directionalPerspective = direction === "right" ? selectedPerspectives[0] : selectedPerspectives[1];
  return uniqueKeywords([
    directionalPerspective,
    ...additionalPerspectives
  ]);
}
function togglePerspectiveReviewPriority(prioritizedPerspectives, perspective) {
  const prioritized = uniqueKeywords(prioritizedPerspectives);
  const identity = perspective.trim().toLocaleLowerCase();
  if (!identity) return prioritized;
  const existingIndex = prioritized.findIndex(
    (item) => item.toLocaleLowerCase() === identity
  );
  if (existingIndex >= 0) {
    return prioritized.filter((_, index) => index !== existingIndex);
  }
  if (prioritized.length >= 2) return prioritized;
  return [...prioritized, perspective.trim()];
}
function appendPerspectivesToLine(line, perspectives) {
  const addedPerspectives = uniqueKeywords(perspectives).filter(
    (perspective) => !lineContainsKeyword(line, perspective)
  );
  if (addedPerspectives.length === 0) {
    return { updatedLine: line, addedPerspectives: [] };
  }
  const trailingWhitespace = line.match(/[\t ]*$/u)?.[0] ?? "";
  const content = trailingWhitespace.length > 0 ? line.slice(0, line.length - trailingWhitespace.length) : line;
  return {
    updatedLine: `${content} ${addedPerspectives.join(" ")}${trailingWhitespace}`,
    addedPerspectives
  };
}
function updatePerspectiveReviewLine(text, lineNumber, expectedLine, perspectives) {
  const lines = normalizedLines(text);
  if (!Number.isInteger(lineNumber) || lineNumber < 0 || lineNumber >= lines.length) {
    throw new Error("\u0421\u0442\u0440\u043E\u043A\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442 \u0432 \u0437\u0430\u043C\u0435\u0442\u043A\u0435.");
  }
  if (lines[lineNumber] !== expectedLine) {
    throw new Error("\u0421\u0442\u0440\u043E\u043A\u0430 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0430\u0441\u044C \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0440\u0430\u0437\u0431\u043E\u0440\u0430. \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u0440\u0435\u0436\u0438\u043C \u0437\u0430\u043D\u043E\u0432\u043E.");
  }
  const { updatedLine, addedPerspectives } = appendPerspectivesToLine(
    expectedLine,
    perspectives
  );
  if (addedPerspectives.length === 0) {
    return { text, updatedLine, addedPerspectives };
  }
  lines[lineNumber] = updatedLine;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return {
    text: lines.join(newline),
    updatedLine,
    addedPerspectives
  };
}
function sortPerspectiveCountsByLineCount(counts) {
  return counts.map((item, originalIndex) => ({ item, originalIndex })).sort(
    (left, right) => right.item.lineCount - left.item.lineCount || left.originalIndex - right.originalIndex
  ).map(({ item }) => item);
}
function appendSection(target, section) {
  if (section.length === 0) return;
  if (target.length > 0 && target[target.length - 1] !== "") target.push("");
  target.push(...section);
}
function sortNoteByKeywords(text, keywords, generatedLines = [], matchMode = "all") {
  const block = findKeywordBlock(text);
  if (!block) {
    throw new Error("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0441\u043F\u0438\u0441\u043E\u043A \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432, \u043D\u0430\u0447\u0438\u043D\u0430\u044E\u0449\u0438\u0439\u0441\u044F \u0441\u043E \u0441\u0442\u0440\u043E\u043A\u0438 ppp.");
  }
  const selectedKeywords = uniqueKeywords(keywords);
  if (selectedKeywords.length === 0) {
    throw new Error("\u041D\u0443\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0443.");
  }
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const keepFinalNewline = /(?:\r\n|\r|\n)$/.test(text);
  const lines = normalizedLines(text);
  if (keepFinalNewline && lines[lines.length - 1] === "") lines.pop();
  const yamlEnd = frontmatterEnd(lines);
  const frontmatter = yamlEnd >= 0 ? lines.slice(0, yamlEnd + 1) : [];
  const content = noteContentLines(text);
  const matchesSelectedKeywords = (line) => matchMode === "all" ? selectedKeywords.every((keyword) => lineContainsKeyword(line, keyword)) : selectedKeywords.some((keyword) => lineContainsKeyword(line, keyword));
  const matching = content.filter(matchesSelectedKeywords);
  const other = content.filter((line) => !matchesSelectedKeywords(line));
  const output = [];
  if (frontmatter.length > 0) output.push(...frontmatter);
  appendSection(output, matching);
  appendSection(output, other);
  appendSection(output, block.rawLines);
  let sortedText = output.join(newline);
  if (keepFinalNewline) sortedText += newline;
  return {
    sortedText,
    matchCount: matching.length,
    otherCount: other.length
  };
}
function toggleKeywordFilter(current, session, keyword, generatedLines = [], matchMode = session?.matchMode ?? "all") {
  const keywordIdentity = keyword.toLocaleLowerCase();
  const wasEnabled = session?.activeKeywords.some(
    (activeKeyword) => activeKeyword.toLocaleLowerCase() === keywordIdentity
  ) ?? false;
  const wasEdited = session !== void 0 && current !== session.filtered;
  if (wasEdited && !wasEnabled) {
    throw new Error(
      "\u041D\u043E\u0432\u0430\u044F \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430 \u043D\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430: \u043F\u043E\u0441\u043B\u0435 \u043E\u0442\u0431\u043E\u0440\u0430 \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u0431\u044B\u043B\u0430 \u043E\u0442\u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0430."
    );
  }
  const activeKeywords = wasEnabled ? (session?.activeKeywords ?? []).filter(
    (activeKeyword) => activeKeyword.toLocaleLowerCase() !== keywordIdentity
  ) : [...session?.activeKeywords ?? [], keyword];
  if (activeKeywords.length === 0) {
    if (wasEdited) {
      return {
        text: current,
        session: null,
        matchCount: 0,
        otherCount: 0,
        outcome: "disabled-after-edit"
      };
    }
    return {
      text: session?.original ?? current,
      session: null,
      matchCount: 0,
      otherCount: 0,
      outcome: "restored"
    };
  }
  const base = session && !wasEdited ? session.original : current;
  const result = sortNoteByKeywords(
    base,
    activeKeywords,
    generatedLines,
    matchMode
  );
  return {
    text: result.sortedText,
    session: {
      original: base,
      filtered: result.sortedText,
      activeKeywords,
      matchMode
    },
    matchCount: result.matchCount,
    otherCount: result.otherCount,
    outcome: "applied"
  };
}
function setKeywordFilterMode(current, session, matchMode, generatedLines = []) {
  if (current !== session.filtered) {
    throw new Error(
      "\u041B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0430: \u043F\u043E\u0441\u043B\u0435 \u043E\u0442\u0431\u043E\u0440\u0430 \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u0431\u044B\u043B\u0430 \u043E\u0442\u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0430."
    );
  }
  const result = sortNoteByKeywords(
    session.original,
    session.activeKeywords,
    generatedLines,
    matchMode
  );
  return {
    text: result.sortedText,
    session: {
      original: session.original,
      filtered: result.sortedText,
      activeKeywords: [...session.activeKeywords],
      matchMode
    },
    matchCount: result.matchCount,
    otherCount: result.otherCount
  };
}

// src/main.ts
var VIEW_TYPE = "perspectivism-view";
var MAX_GENERATED_RESULTS = 5e3;
var KeywordPixel = class {
  constructor(context, x, y, color, speed, delay, width, height, opacity) {
    this.context = context;
    this.x = x;
    this.y = y;
    this.color = color;
    this.delay = delay;
    this.opacity = opacity;
    this.speed = (Math.random() * 0.8 + 0.1) * speed;
    this.sizeStep = Math.random() * 0.32 + 0.08;
    this.maxSize = Math.random() * 1.8 + this.minSize;
    this.counterStep = Math.random() * 4 + (width + height) * 0.01;
  }
  context;
  x;
  y;
  color;
  delay;
  opacity;
  speed;
  sizeStep;
  minSize = 0.5;
  maxSize;
  counterStep;
  size = 0;
  counter = 0;
  isReverse = false;
  isShimmering = false;
  isIdle = true;
  appear() {
    this.isIdle = false;
    if (this.counter <= this.delay) {
      this.counter += this.counterStep;
      return;
    }
    if (this.size >= this.maxSize) this.isShimmering = true;
    if (this.isShimmering) this.shimmer();
    else this.size += this.sizeStep;
    this.draw();
  }
  disappear() {
    this.isShimmering = false;
    this.counter = 0;
    if (this.size <= 0) {
      this.size = 0;
      this.isIdle = true;
      return;
    }
    this.isIdle = false;
    this.size -= 0.12;
    this.draw();
  }
  shimmer() {
    if (this.size >= this.maxSize) this.isReverse = true;
    else if (this.size <= this.minSize) this.isReverse = false;
    this.size += this.isReverse ? -this.speed : this.speed;
  }
  draw() {
    const centerOffset = 1.25 - this.size * 0.5;
    this.context.fillStyle = this.color;
    this.context.globalAlpha = this.opacity;
    this.context.fillRect(
      this.x + centerOffset,
      this.y + centerOffset,
      Math.max(0, this.size),
      Math.max(0, this.size)
    );
  }
};
var KeywordPixelCardEffect = class {
  constructor(card) {
    this.card = card;
    this.canvas = card.createEl("canvas", {
      cls: "perspectivism-pixel-canvas",
      attr: { "aria-hidden": "true" }
    });
    this.context = this.canvas.getContext("2d");
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resizeObserver = new ResizeObserver(() => this.initializePixels());
    this.resizeObserver.observe(card);
    if (!this.reducedMotion) {
      card.addEventListener("pointerenter", this.onPointerEnter);
      card.addEventListener("pointerleave", this.onPointerLeave);
      card.addEventListener("focus", this.onFocus);
      card.addEventListener("blur", this.onBlur);
    }
    this.initializePixels();
  }
  card;
  canvas;
  context;
  resizeObserver;
  reducedMotion;
  pixels = [];
  animationFrame = null;
  previousTime = performance.now();
  width = 0;
  height = 0;
  destroyed = false;
  destroy() {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.card.removeEventListener("pointerenter", this.onPointerEnter);
    this.card.removeEventListener("pointerleave", this.onPointerLeave);
    this.card.removeEventListener("focus", this.onFocus);
    this.card.removeEventListener("blur", this.onBlur);
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.pixels = [];
  }
  onPointerEnter = () => {
    this.initializePixels();
    this.startAnimation("appear");
  };
  onPointerLeave = () => {
    this.startAnimation("disappear");
  };
  onFocus = () => {
    this.initializePixels();
    this.startAnimation("appear");
  };
  onBlur = () => {
    this.startAnimation("disappear");
  };
  initializePixels() {
    if (this.destroyed || !this.context) return;
    const rect = this.card.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (width <= 1 || height <= 1) return;
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(width * deviceScale);
    this.canvas.height = Math.floor(height * deviceScale);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    this.width = width;
    this.height = height;
    const styles = getComputedStyle(this.card);
    const colors = [
      styles.getPropertyValue("--interactive-accent").trim(),
      styles.getPropertyValue("--text-accent").trim(),
      styles.getPropertyValue("--text-muted").trim()
    ].filter((color) => color.length > 0);
    const palette = colors.length > 0 ? colors : [styles.color];
    const gap = 7;
    const speed = 0.035;
    const pixels = [];
    for (let x = 0; x < width; x += gap) {
      for (let y = 0; y < height; y += gap) {
        const dx = x - width / 2;
        const dy = y - height / 2;
        const distance = Math.sqrt(dx * dx + dy * dy);
        pixels.push(
          new KeywordPixel(
            this.context,
            x,
            y,
            palette[Math.floor(Math.random() * palette.length)],
            speed,
            distance,
            width,
            height,
            Math.random() * 0.28 + 0.2
          )
        );
      }
    }
    this.pixels = pixels;
    this.context.clearRect(0, 0, width, height);
    this.context.globalAlpha = 1;
  }
  startAnimation(animation) {
    if (this.destroyed || this.reducedMotion || !this.context) return;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame(() => this.animate(animation));
  }
  animate(animation) {
    if (this.destroyed || !this.context) return;
    const now = performance.now();
    const frameInterval = 1e3 / 60;
    const elapsed = now - this.previousTime;
    if (elapsed < frameInterval) {
      this.animationFrame = requestAnimationFrame(() => this.animate(animation));
      return;
    }
    this.previousTime = now - elapsed % frameInterval;
    this.context.clearRect(0, 0, this.width, this.height);
    let allIdle = true;
    for (const pixel of this.pixels) {
      pixel[animation]();
      if (!pixel.isIdle) allIdle = false;
    }
    this.context.globalAlpha = 1;
    if (animation === "disappear" && allIdle) {
      this.animationFrame = null;
      return;
    }
    this.animationFrame = requestAnimationFrame(() => this.animate(animation));
  }
};
function replaceEditorTextPreservingCursor(editor, updated) {
  const current = editor.getValue();
  const change = createMinimalTextChange(current, updated);
  if (!change) return false;
  const selections = editor.listSelections().map(({ anchor, head }) => ({
    anchor: editor.posToOffset(anchor),
    head: editor.posToOffset(head)
  }));
  editor.transaction(
    {
      changes: [
        {
          from: editor.offsetToPos(change.fromOffset),
          to: editor.offsetToPos(change.toOffset),
          text: change.replacement
        }
      ]
    },
    "perspectivism"
  );
  editor.setSelections(
    selections.map(({ anchor, head }) => ({
      anchor: editor.offsetToPos(mapOffsetThroughTextChange(anchor, change)),
      head: editor.offsetToPos(mapOffsetThroughTextChange(head, change))
    }))
  );
  return true;
}
var PerspectiveReviewModal = class extends import_obsidian.Modal {
  constructor(app, plugin, file, perspectives, resume) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.perspectives = perspectives;
    if (resume) {
      this.selectedPerspectives = new Set(resume.selectedPerspectives);
      this.prioritizedPerspectives = [...resume.prioritizedPerspectives];
      this.skipLinesWithAnySelectedPerspective = resume.skipLinesWithAnySelectedPerspective;
      this.queue = resume.queue;
      this.currentIndex = resume.currentIndex;
      this.addedPerspectiveCount = resume.addedPerspectiveCount;
      this.changedLineCount = resume.changedLineCount;
      this.skippedLineCount = resume.skippedLineCount;
      this.started = true;
    }
  }
  plugin;
  file;
  perspectives;
  selectedPerspectives = /* @__PURE__ */ new Set();
  prioritizedPerspectives = [];
  skipLinesWithAnySelectedPerspective = true;
  queue = [];
  currentIndex = 0;
  selectedForCurrentLine = /* @__PURE__ */ new Set();
  started = false;
  closed = false;
  processing = false;
  addedPerspectiveCount = 0;
  changedLineCount = 0;
  skippedLineCount = 0;
  dragStartX = null;
  dragPointerId = null;
  pickerClickTimer = null;
  searchQuery = "";
  onOpen() {
    this.modalEl.addClass("perspectivism-review-modal");
    this.contentEl.addClass("perspectivism-review-content");
    this.contentEl.addEventListener("keydown", this.onKeyDown);
    if (this.started) this.renderCurrentLine();
    else this.renderPicker();
  }
  onClose() {
    if (this.closed) return;
    this.closed = true;
    this.cancelPickerClickTimer();
    this.contentEl.removeEventListener("keydown", this.onKeyDown);
    if (this.started) this.plugin.finishPerspectiveReview(this.file.path);
    this.contentEl.empty();
  }
  renderPicker() {
    this.cancelPickerClickTimer();
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "\u0420\u0430\u0437\u0431\u043E\u0440 \u0441\u0442\u0440\u043E\u043A" });
    this.contentEl.createDiv({
      cls: "perspectivism-review-lead",
      text: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u044B"
    });
    const search = this.contentEl.createEl("input", {
      cls: "perspectivism-review-search",
      attr: {
        type: "search",
        placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432",
        "aria-label": "\u041F\u043E\u0438\u0441\u043A \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432"
      }
    });
    search.value = this.searchQuery;
    search.addEventListener("input", () => {
      this.searchQuery = search.value;
      this.renderPicker();
      const nextSearch = this.contentEl.querySelector(
        ".perspectivism-review-search"
      );
      nextSearch?.focus();
      nextSearch?.setSelectionRange(this.searchQuery.length, this.searchQuery.length);
    });
    const list = this.contentEl.createDiv({ cls: "perspectivism-review-picker" });
    const normalizedQuery = this.searchQuery.trim().toLocaleLowerCase();
    for (const perspective of this.perspectives.filter(
      (item) => normalizedQuery.length === 0 || item.toLocaleLowerCase().includes(normalizedQuery)
    )) {
      const enabled = this.selectedPerspectives.has(perspective);
      const priorityIndex = this.prioritizedPerspectives.findIndex(
        (item) => item.toLocaleLowerCase() === perspective.toLocaleLowerCase()
      );
      const prioritized = priorityIndex >= 0;
      const priorityAvailable = prioritized || this.prioritizedPerspectives.length < 2;
      const button = list.createEl("button", {
        cls: `perspectivism-review-perspective${enabled ? " is-enabled" : ""}${prioritized ? " is-prioritized" : ""}${priorityAvailable ? "" : " is-priority-unavailable"}`,
        attr: {
          type: "button",
          role: "switch",
          "aria-checked": enabled ? "true" : "false",
          title: prioritized ? "\u0414\u0432\u043E\u0439\u043D\u043E\u0435 \u043D\u0430\u0436\u0430\u0442\u0438\u0435 \u2014 \u043E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C" : priorityAvailable ? "\u0414\u0432\u043E\u0439\u043D\u043E\u0435 \u043D\u0430\u0436\u0430\u0442\u0438\u0435 \u2014 \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0434\u043B\u044F \u0441\u0442\u0440\u0435\u043B\u043E\u043A" : "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u0435 \u043E\u0434\u043D\u0443 \u0438\u0437 \u0434\u0432\u0443\u0445 \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u043D\u044B\u0445 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432"
        }
      });
      button.createSpan({
        cls: "perspectivism-review-perspective-label",
        text: perspective
      });
      if (prioritized) {
        button.createSpan({
          cls: "perspectivism-review-priority-direction",
          text: priorityIndex === 0 ? "\u2192" : "\u2190",
          attr: {
            "aria-label": priorityIndex === 0 ? "\u041F\u0435\u0440\u0432\u0430\u044F \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u043D\u0430\u044F \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430: \u0441\u0442\u0440\u0435\u043B\u043A\u0430 \u0432\u043F\u0440\u0430\u0432\u043E" : "\u0412\u0442\u043E\u0440\u0430\u044F \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u043D\u0430\u044F \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430: \u0441\u0442\u0440\u0435\u043B\u043A\u0430 \u0432\u043B\u0435\u0432\u043E"
          }
        });
      }
      button.addEventListener("click", (event) => {
        if (event.detail !== 1) return;
        this.cancelPickerClickTimer();
        this.pickerClickTimer = window.setTimeout(() => {
          this.pickerClickTimer = null;
          this.togglePerspectiveSelection(perspective);
        }, 220);
      });
      button.addEventListener("dblclick", (event) => {
        event.preventDefault();
        this.cancelPickerClickTimer();
        this.togglePerspectivePriority(perspective);
      });
    }
    const skipOption = this.contentEl.createEl("button", {
      cls: `perspectivism-review-skip-option${this.skipLinesWithAnySelectedPerspective ? " is-enabled" : ""}`,
      attr: {
        type: "button",
        role: "switch",
        "aria-checked": this.skipLinesWithAnySelectedPerspective ? "true" : "false"
      }
    });
    skipOption.createSpan({
      cls: "perspectivism-review-skip-label",
      text: "\u041F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0438 \u0441 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0439 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u043E\u0439"
    });
    const skipTrack = skipOption.createSpan({
      cls: "perspectivism-review-skip-track"
    });
    skipTrack.createSpan({ cls: "perspectivism-review-skip-knob" });
    skipOption.addEventListener("click", () => {
      this.skipLinesWithAnySelectedPerspective = !this.skipLinesWithAnySelectedPerspective;
      this.renderPicker();
    });
    const footer = this.contentEl.createDiv({ cls: "perspectivism-review-picker-footer" });
    footer.createSpan({
      cls: "perspectivism-review-selection-count",
      text: `\u0412\u044B\u0431\u0440\u0430\u043D\u043E: ${this.selectedPerspectives.size}`
    });
    const startButton = footer.createEl("button", {
      cls: "mod-cta perspectivism-review-start",
      text: "\u0421\u0442\u0430\u0440\u0442",
      attr: { type: "button" }
    });
    startButton.disabled = this.selectedPerspectives.size === 0;
    startButton.addEventListener("click", () => this.start());
  }
  start() {
    if (this.selectedPerspectives.size === 0) return;
    this.cancelPickerClickTimer();
    try {
      this.queue = this.plugin.preparePerspectiveReview(
        this.file,
        [...this.selectedPerspectives],
        this.skipLinesWithAnySelectedPerspective
      );
      this.started = true;
      this.currentIndex = 0;
      void this.persistProgress();
      this.renderCurrentLine();
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043D\u0430\u0447\u0430\u0442\u044C \u0440\u0430\u0437\u0431\u043E\u0440 \u0441\u0442\u0440\u043E\u043A.";
      new import_obsidian.Notice(message);
    }
  }
  renderCurrentLine() {
    this.processing = false;
    this.dragStartX = null;
    this.dragPointerId = null;
    this.selectedForCurrentLine.clear();
    this.contentEl.empty();
    if (this.currentIndex >= this.queue.length) {
      this.renderFinished();
      return;
    }
    const item = this.queue[this.currentIndex];
    const hybridMode = this.isHybridDirectionalMode();
    const directionalMode = this.isDirectionalMode();
    const directionalPerspectives = this.getDirectionalPerspectives();
    const header = this.contentEl.createDiv({ cls: "perspectivism-review-header" });
    header.createEl("h2", { text: "\u0420\u0430\u0437\u0431\u043E\u0440 \u0441\u0442\u0440\u043E\u043A" });
    header.createSpan({
      cls: "perspectivism-review-progress",
      text: `${this.currentIndex + 1} / ${this.queue.length}`
    });
    const card = this.contentEl.createDiv({
      cls: "perspectivism-review-card",
      attr: { tabindex: "0" }
    });
    card.createDiv({ cls: "perspectivism-review-line", text: item.text });
    card.addEventListener("pointerdown", (event) => {
      if (!directionalMode || this.processing || event.button !== 0) return;
      this.dragStartX = event.clientX;
      this.dragPointerId = event.pointerId;
      card.setPointerCapture(event.pointerId);
      card.addClass("is-dragging");
    });
    card.addEventListener("pointermove", (event) => {
      if (!directionalMode || this.dragStartX === null || this.dragPointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - this.dragStartX;
      card.style.transform = `translateX(${deltaX}px) rotate(${deltaX / 24}deg)`;
      card.style.opacity = String(Math.max(0.45, 1 - Math.abs(deltaX) / 500));
      card.toggleClass("is-left", deltaX < -12);
      card.toggleClass("is-right", deltaX > 12);
    });
    const endDrag = (event) => {
      if (!directionalMode || this.dragStartX === null || this.dragPointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - this.dragStartX;
      const threshold = Math.min(110, Math.max(64, card.clientWidth * 0.24));
      this.dragStartX = null;
      this.dragPointerId = null;
      card.removeClass("is-dragging");
      if (Math.abs(deltaX) >= threshold) {
        this.processDirection(deltaX > 0 ? "right" : "left", card);
        return;
      }
      this.resetDraggedCard(card);
    };
    card.addEventListener("pointerup", endDrag);
    card.addEventListener("pointercancel", () => {
      this.dragStartX = null;
      this.dragPointerId = null;
      card.removeClass("is-dragging");
      this.resetDraggedCard(card);
    });
    if (this.selectedPerspectives.size === 1) {
      this.renderSingleControls(item, card);
      if (import_obsidian.Platform.isPhone) this.renderMobileSkipButton(card);
      window.setTimeout(() => card.focus(), 0);
      return;
    }
    if (this.selectedPerspectives.size === 2) {
      this.renderTwoControls(item, card, directionalPerspectives);
      if (import_obsidian.Platform.isPhone) this.renderMobileSkipButton(card);
      window.setTimeout(() => card.focus(), 0);
      return;
    }
    if (hybridMode) {
      this.renderHybridControls(item, card, directionalPerspectives);
      window.setTimeout(() => card.focus(), 0);
      return;
    }
    this.renderMultipleControls(item);
  }
  renderSingleControls(item, card) {
    const perspective = [...this.selectedPerspectives][0];
    this.contentEl.createDiv({
      cls: "perspectivism-review-single-perspective",
      text: perspective
    });
    const actions = this.contentEl.createDiv({ cls: "perspectivism-review-swipe-actions" });
    const reject = actions.createEl("button", {
      cls: "perspectivism-review-swipe-button is-reject",
      text: "\u2190",
      attr: { type: "button", "aria-label": "\u041D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0442\u044C \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0443" }
    });
    const accept = actions.createEl("button", {
      cls: "perspectivism-review-swipe-button is-accept",
      text: "\u2192",
      attr: { type: "button", "aria-label": "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0443" }
    });
    if (item.presentPerspectives.some(
      (present) => present.toLocaleLowerCase() === perspective.toLocaleLowerCase()
    )) {
      accept.disabled = true;
      accept.title = "\u042D\u0442\u0430 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0432 \u0441\u0442\u0440\u043E\u043A\u0435";
    }
    reject.addEventListener("click", () => this.processDirection("left", card));
    accept.addEventListener("click", () => this.processDirection("right", card));
  }
  renderTwoControls(item, card, directionalPerspectives) {
    const [firstPerspective, secondPerspective] = directionalPerspectives;
    const actions = this.contentEl.createDiv({
      cls: "perspectivism-review-two-actions"
    });
    const left = actions.createEl("button", {
      cls: "perspectivism-review-direction-button is-left-direction",
      attr: {
        type: "button",
        "aria-label": `\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0443 \xAB${secondPerspective}\xBB`
      }
    });
    left.createSpan({ cls: "perspectivism-review-direction-arrow", text: "\u2190" });
    left.createSpan({ text: secondPerspective });
    const right = actions.createEl("button", {
      cls: "perspectivism-review-direction-button is-right-direction",
      attr: {
        type: "button",
        "aria-label": `\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0443 \xAB${firstPerspective}\xBB`
      }
    });
    right.createSpan({ text: firstPerspective });
    right.createSpan({ cls: "perspectivism-review-direction-arrow", text: "\u2192" });
    const present = new Set(
      item.presentPerspectives.map((perspective) => perspective.toLocaleLowerCase())
    );
    const leftUnavailable = present.has(secondPerspective.toLocaleLowerCase());
    const rightUnavailable = present.has(firstPerspective.toLocaleLowerCase());
    left.disabled = leftUnavailable;
    right.disabled = rightUnavailable;
    if (leftUnavailable) left.title = "\u042D\u0442\u0430 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0432 \u0441\u0442\u0440\u043E\u043A\u0435";
    if (rightUnavailable) right.title = "\u042D\u0442\u0430 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0432 \u0441\u0442\u0440\u043E\u043A\u0435";
    left.addEventListener("click", () => this.processDirection("left", card));
    right.addEventListener("click", () => this.processDirection("right", card));
  }
  renderMultipleControls(item) {
    this.renderPerspectiveSwitches(item, [...this.selectedPerspectives]);
    const applyButton = this.contentEl.createEl("button", {
      cls: "mod-cta perspectivism-review-apply",
      text: "\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C",
      attr: { type: "button" }
    });
    applyButton.addEventListener("click", () => this.processMultiple());
  }
  renderHybridControls(item, card, directionalPerspectives) {
    const prioritizedIdentities = new Set(
      directionalPerspectives.map(
        (perspective) => perspective.toLocaleLowerCase()
      )
    );
    const buttonPerspectives = [...this.selectedPerspectives].filter(
      (perspective) => !prioritizedIdentities.has(perspective.toLocaleLowerCase())
    );
    this.renderPerspectiveSwitches(item, buttonPerspectives);
    this.renderTwoControls(item, card, directionalPerspectives);
    if (import_obsidian.Platform.isPhone) this.renderMobileSkipButton(card);
  }
  renderMobileSkipButton(card) {
    if (!import_obsidian.Platform.isPhone) return;
    const button = this.contentEl.createEl("button", {
      cls: "perspectivism-review-mobile-skip",
      text: "\u2191",
      attr: { type: "button", "aria-label": "\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443" }
    });
    button.addEventListener("click", () => this.processDirection("up", card));
  }
  renderPerspectiveSwitches(item, perspectives) {
    const present = new Set(
      item.presentPerspectives.map((perspective) => perspective.toLocaleLowerCase())
    );
    const switches = this.contentEl.createDiv({
      cls: "perspectivism-review-multiple-perspectives"
    });
    for (const perspective of perspectives) {
      const identity = perspective.toLocaleLowerCase();
      const alreadyPresent = present.has(identity);
      const enabled = alreadyPresent || this.selectedForCurrentLine.has(perspective);
      const button = switches.createEl("button", {
        cls: `perspectivism-review-perspective${enabled ? " is-enabled" : ""}${alreadyPresent ? " is-existing" : ""}`,
        text: perspective,
        attr: {
          type: "button",
          role: "switch",
          "aria-checked": enabled ? "true" : "false",
          "aria-disabled": alreadyPresent ? "true" : "false",
          title: alreadyPresent ? "\u0423\u0436\u0435 \u0435\u0441\u0442\u044C \u0432 \u0441\u0442\u0440\u043E\u043A\u0435" : ""
        }
      });
      button.disabled = alreadyPresent;
      button.addEventListener("click", () => {
        if (this.selectedForCurrentLine.has(perspective)) {
          this.selectedForCurrentLine.delete(perspective);
        } else {
          this.selectedForCurrentLine.add(perspective);
        }
        button.toggleClass(
          "is-enabled",
          this.selectedForCurrentLine.has(perspective)
        );
        button.setAttr(
          "aria-checked",
          this.selectedForCurrentLine.has(perspective) ? "true" : "false"
        );
        this.updateMultipleActionLabel();
      });
    }
  }
  updateMultipleActionLabel() {
    const button = this.contentEl.querySelector(
      ".perspectivism-review-apply"
    );
    if (!button) return;
    button.setText(
      this.selectedForCurrentLine.size > 0 ? "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0438 \u0434\u0430\u043B\u044C\u0448\u0435" : "\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C"
    );
  }
  processDirection(direction, card) {
    if (this.processing) return;
    if (direction !== "up") {
      const item = this.queue[this.currentIndex];
      const directional = this.getDirectionalPerspectives();
      const chosen = direction === "right" ? directional[0] : directional[1];
      if (chosen && item.presentPerspectives.some(
        (present) => present.toLocaleLowerCase() === chosen.toLocaleLowerCase()
      )) {
        new import_obsidian.Notice("\u042D\u0442\u0430 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0432 \u0441\u0442\u0440\u043E\u043A\u0435.");
        return;
      }
    }
    this.processing = true;
    card.addClass(`is-exiting-${direction}`);
    window.setTimeout(() => {
      if (this.closed) return;
      const directionalPerspectives = this.getDirectionalPerspectives();
      const additionalPerspectives = this.isHybridDirectionalMode() ? [...this.selectedForCurrentLine] : [];
      const perspectives = perspectivesForReviewDirection(
        directionalPerspectives,
        direction,
        additionalPerspectives
      );
      if (!this.applyCurrentLine(perspectives)) {
        this.processing = false;
        this.resetDraggedCard(card);
        return;
      }
      this.renderCurrentLine();
    }, 150);
  }
  processMultiple() {
    if (this.processing) return;
    this.processing = true;
    if (!this.applyCurrentLine([...this.selectedForCurrentLine])) {
      this.processing = false;
      return;
    }
    this.renderCurrentLine();
  }
  applyCurrentLine(perspectives) {
    const item = this.queue[this.currentIndex];
    try {
      const beforeText = this.plugin.getOpenNoteText(this.file.path);
      const added = this.plugin.applyPerspectiveReviewLine(
        this.file,
        item,
        perspectives
      );
      if (added > 0) {
        this.addedPerspectiveCount += added;
        this.changedLineCount += 1;
      } else {
        this.skippedLineCount += 1;
      }
      const afterText = this.plugin.getOpenNoteText(this.file.path);
      this.plugin.setReviewLastAction(this.file.path, {
        beforeText,
        afterText,
        currentIndex: this.currentIndex,
        addedPerspectiveCount: this.addedPerspectiveCount - (added > 0 ? added : 0),
        changedLineCount: this.changedLineCount - (added > 0 ? 1 : 0),
        skippedLineCount: this.skippedLineCount - (added > 0 ? 0 : 1)
      });
      this.currentIndex += 1;
      void this.persistProgress();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443.";
      new import_obsidian.Notice(message, 8e3);
      return false;
    }
  }
  persistProgress() {
    return this.plugin.savePerspectiveReview(this.file.path, {
      selectedPerspectives: [...this.selectedPerspectives],
      prioritizedPerspectives: [...this.prioritizedPerspectives],
      skipLinesWithAnySelectedPerspective: this.skipLinesWithAnySelectedPerspective,
      queue: this.queue,
      currentIndex: this.currentIndex,
      addedPerspectiveCount: this.addedPerspectiveCount,
      changedLineCount: this.changedLineCount,
      skippedLineCount: this.skippedLineCount,
      lastAction: this.plugin.getReviewLastAction(this.file.path)
    });
  }
  resetDraggedCard(card) {
    card.removeClass("is-left");
    card.removeClass("is-right");
    card.removeClass("is-exiting-left");
    card.removeClass("is-exiting-right");
    card.removeClass("is-exiting-up");
    card.style.transform = "";
    card.style.opacity = "";
  }
  renderFinished() {
    this.contentEl.createEl("h2", { text: "\u0420\u0430\u0437\u0431\u043E\u0440 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D" });
    this.contentEl.createDiv({
      cls: "perspectivism-review-finished-count",
      text: `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432: ${this.addedPerspectiveCount}. \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u043E \u0441\u0442\u0440\u043E\u043A: ${this.changedLineCount}. \u041F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E: ${this.skippedLineCount}.`
    });
    const closeButton = this.contentEl.createEl("button", {
      cls: "mod-cta perspectivism-review-close",
      text: "\u0413\u043E\u0442\u043E\u0432\u043E",
      attr: { type: "button" }
    });
    closeButton.addEventListener("click", () => this.close());
    window.setTimeout(() => closeButton.focus(), 0);
  }
  onKeyDown = (event) => {
    if (!this.started || this.currentIndex >= this.queue.length || this.processing) {
      return;
    }
    if (this.isDirectionalMode()) {
      const card = this.contentEl.querySelector(
        ".perspectivism-review-card"
      );
      if (!card) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.processDirection("left", card);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.processDirection("right", card);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.processDirection("up", card);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      this.processMultiple();
    }
  };
  togglePerspectiveSelection(perspective) {
    if (this.selectedPerspectives.has(perspective)) {
      this.selectedPerspectives.delete(perspective);
      const identity = perspective.toLocaleLowerCase();
      this.prioritizedPerspectives = this.prioritizedPerspectives.filter(
        (item) => item.toLocaleLowerCase() !== identity
      );
    } else {
      this.selectedPerspectives.add(perspective);
    }
    this.renderPicker();
  }
  togglePerspectivePriority(perspective) {
    const nextPriorities = togglePerspectiveReviewPriority(
      this.prioritizedPerspectives,
      perspective
    );
    const changed = nextPriorities.length !== this.prioritizedPerspectives.length || nextPriorities.some(
      (item, index) => item !== this.prioritizedPerspectives[index]
    );
    if (!changed) return;
    this.selectedPerspectives.add(perspective);
    this.prioritizedPerspectives = nextPriorities;
    this.renderPicker();
  }
  getDirectionalPerspectives() {
    if (this.selectedPerspectives.size === 1) {
      return [...this.selectedPerspectives];
    }
    if (this.prioritizedPerspectives.length === 2) {
      return [...this.prioritizedPerspectives];
    }
    return [...this.selectedPerspectives].slice(0, 2);
  }
  isHybridDirectionalMode() {
    return this.selectedPerspectives.size > 2 && this.prioritizedPerspectives.length === 2;
  }
  isDirectionalMode() {
    return this.selectedPerspectives.size <= 2 || this.isHybridDirectionalMode();
  }
  cancelPickerClickTimer() {
    if (this.pickerClickTimer === null) return;
    window.clearTimeout(this.pickerClickTimer);
    this.pickerClickTimer = null;
  }
};
var PerspectivismView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  plugin;
  renderSequence = 0;
  pixelCardEffects = [];
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "\u041F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u044B";
  }
  getIcon() {
    return "list-filter";
  }
  async onOpen() {
    await this.refresh();
  }
  async onClose() {
    this.destroyPixelCardEffects();
  }
  requestRefresh() {
    void this.refresh();
  }
  async refresh() {
    const sequence = ++this.renderSequence;
    const container = this.containerEl.children[1];
    this.destroyPixelCardEffects();
    container.empty();
    container.addClass("perspectivism-panel");
    const panelHeader = container.createDiv({
      cls: "perspectivism-panel-header"
    });
    panelHeader.createEl("h4", { text: "\u041F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u044B" });
    const view = this.plugin.getTargetMarkdownView();
    const file = view?.file;
    if (!view || !file) {
      this.renderMessage(container, "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0443 Markdown.");
      return;
    }
    const text = view.editor.getValue();
    const block = findKeywordBlock(text);
    if (sequence !== this.renderSequence) return;
    if (!block) {
      this.renderMessage(
        container,
        "\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0441\u043F\u0438\u0441\u043E\u043A \u0441 \u043F\u0435\u0440\u0432\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u043E\u0439 ppp."
      );
      this.renderExample(container);
      return;
    }
    if (block.keywords.length === 0) {
      this.renderMessage(container, "\u0412 \u0441\u043B\u0443\u0436\u0435\u0431\u043D\u043E\u043C \u0431\u043B\u043E\u043A\u0435 \u043D\u0435\u0442 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432.");
      this.renderExample(container);
      return;
    }
    const reviewButton = container.createEl("button", {
      cls: "perspectivism-review-open",
      text: "\u0420\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0438",
      attr: { type: "button" }
    });
    reviewButton.addEventListener("click", () => {
      this.plugin.openPerspectiveReview(file);
    });
    const session = this.plugin.getSession(file.path);
    const activeKeywords = session?.activeKeywords ?? [];
    const activeKeywordIdentities = new Set(
      activeKeywords.map((keyword) => keyword.toLocaleLowerCase())
    );
    const matchMode = this.plugin.getKeywordMatchMode(file.path);
    const actionGroup = panelHeader.createDiv({ cls: "perspectivism-logic" });
    const actionOptions = [
      { symbol: "\u21B6", label: "\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u043F\u043E\u0440\u044F\u0434\u043E\u043A", run: () => this.plugin.restoreOriginalOrder(file) },
      { symbol: "\u21A9", label: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043E\u0442\u0432\u0435\u0442 \u0440\u0430\u0437\u0431\u043E\u0440\u0430", run: () => this.plugin.undoPerspectiveReview(file) },
      { symbol: "\u25B6", label: "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0439 \u0440\u0430\u0437\u0431\u043E\u0440", run: () => this.plugin.resumePerspectiveReview(file) }
    ];
    for (const option of actionOptions) {
      const button = actionGroup.createEl("button", {
        cls: "perspectivism-logic-button",
        text: option.symbol,
        attr: { type: "button", "aria-label": option.label, title: option.label }
      });
      button.addEventListener("click", option.run);
    }
    const sortByCount = this.plugin.isPerspectiveOrderSortedByCount();
    const orderButton = container.createEl("button", {
      cls: `perspectivism-order-switch${sortByCount ? " is-enabled" : ""}`,
      attr: {
        type: "button",
        role: "switch",
        "aria-checked": sortByCount ? "true" : "false",
        "aria-label": `${sortByCount ? "\u0412\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u044C" : "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C"} \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432 \u043F\u043E \u0443\u0431\u044B\u0432\u0430\u043D\u0438\u044E \u0447\u0438\u0441\u043B\u0430 \u0441\u0442\u0440\u043E\u043A`
      }
    });
    const orderTrack = orderButton.createSpan({
      cls: "perspectivism-toggle-track"
    });
    orderTrack.createSpan({ cls: "perspectivism-toggle-knob" });
    orderButton.addEventListener("click", () => {
      this.plugin.togglePerspectiveOrder();
    });
    const logicGroup = actionGroup;
    logicGroup.setAttr("role", "toolbar");
    logicGroup.setAttr("aria-label", "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0438 \u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044F");
    const logicOptions = [
      {
        mode: "all",
        label: "\u0418",
        symbol: "\u2227",
        description: "\u0441\u0442\u0440\u043E\u043A\u0430 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0432\u0441\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u044B"
      },
      {
        mode: "any",
        label: "\u0418\u041B\u0418",
        symbol: "\u2228",
        description: "\u0441\u0442\u0440\u043E\u043A\u0430 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u0443\u044E \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0443"
      }
    ];
    for (const option of logicOptions) {
      const enabled = matchMode === option.mode;
      const button = logicGroup.createEl("button", {
        cls: `perspectivism-logic-button${enabled ? " is-enabled" : ""}`,
        text: option.symbol,
        attr: {
          type: "button",
          role: "radio",
          "aria-checked": enabled ? "true" : "false",
          "aria-label": `${option.label}: ${option.description}`,
          title: `${option.label}: ${option.description}`
        }
      });
      button.addEventListener("click", () => {
        void this.plugin.setKeywordMatchMode(file, option.mode);
      });
    }
    const counts = countPerspectiveLines(text, block.keywords);
    const displayedPerspectives = sortByCount ? sortPerspectiveCountsByLineCount(counts) : counts;
    const list = container.createDiv({ cls: "perspectivism-list" });
    for (const { perspective: keyword, lineCount } of displayedPerspectives) {
      const enabled = activeKeywordIdentities.has(keyword.toLocaleLowerCase());
      const button = list.createEl("button", {
        cls: `perspectivism-toggle${enabled ? " is-enabled" : ""}`,
        attr: {
          type: "button",
          role: "switch",
          "aria-checked": enabled ? "true" : "false",
          "aria-label": `${enabled ? "\u0412\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u044C" : "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C"} \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0443 ${keyword}; \u0441\u0442\u0440\u043E\u043A \u2014 ${lineCount}`
        }
      });
      this.pixelCardEffects.push(new KeywordPixelCardEffect(button));
      button.createSpan({ cls: "perspectivism-toggle-label", text: keyword });
      const actions = button.createSpan({ cls: "perspectivism-toggle-actions" });
      actions.createSpan({
        cls: "perspectivism-line-count",
        text: String(lineCount),
        attr: { title: `\u0421\u0442\u0440\u043E\u043A \u0441 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u043E\u0439 \xAB${keyword}\xBB: ${lineCount}` }
      });
      const track = actions.createSpan({ cls: "perspectivism-toggle-track" });
      track.createSpan({ cls: "perspectivism-toggle-knob" });
      button.addEventListener("click", () => {
        void this.plugin.toggleKeyword(file, keyword);
      });
    }
    const hint = container.createDiv({ cls: "perspectivism-hint" });
    hint.setText(
      activeKeywords.length > 0 ? matchMode === "all" ? `\u0412\u044B\u0431\u0440\u0430\u043D\u044B \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u044B: ${activeKeywords.join(", ")}. \u0420\u0435\u0436\u0438\u043C \u0418: \u043D\u0430\u0432\u0435\u0440\u0445\u0443 \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0442\u0440\u043E\u043A\u0438 \u0441\u043E \u0432\u0441\u0435\u043C\u0438 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u043C\u0438 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430\u043C\u0438.` : `\u0412\u044B\u0431\u0440\u0430\u043D\u044B \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u044B: ${activeKeywords.join(", ")}. \u0420\u0435\u0436\u0438\u043C \u0418\u041B\u0418: \u043D\u0430\u0432\u0435\u0440\u0445\u0443 \u0441\u0442\u0440\u043E\u043A\u0438 \u0445\u043E\u0442\u044F \u0431\u044B \u0441 \u043E\u0434\u043D\u043E\u0439 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0439 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u043E\u0439.` : "\u041C\u043E\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432 \u043E\u0434\u043D\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E."
    );
  }
  destroyPixelCardEffects() {
    for (const effect of this.pixelCardEffects) effect.destroy();
    this.pixelCardEffects = [];
  }
  renderMessage(container, text) {
    container.createDiv({ cls: "perspectivism-empty", text });
  }
  renderExample(container) {
    const example = container.createEl("pre", { cls: "perspectivism-example" });
    example.setText("ppp\n- [ ] p\nscan on\n\u043A\u0443\u043F\u0438\u0442\u044C\n\u0441\u0434\u0435\u043B\u0430\u0442\u044C\n\n");
  }
};
var PerspectivismPlugin = class extends import_obsidian.Plugin {
  sessions = /* @__PURE__ */ new Map();
  generatedResults = /* @__PURE__ */ new Map();
  excludedNotesText = "";
  excludedNoteNames = [];
  excludedTitleKeywordsText = "";
  excludedTitleKeywords = [];
  savePromise = Promise.resolve();
  refreshTimer = null;
  analysisTimer = null;
  lastMarkdownPath = null;
  analysisSequence = 0;
  analysisPath = null;
  sortPerspectivesByCount = false;
  keywordMatchMode = "all";
  perspectiveReviewPath = null;
  reviewSessions = /* @__PURE__ */ new Map();
  scanDirectiveStates = /* @__PURE__ */ new Map();
  scanConfigurationStates = /* @__PURE__ */ new Map();
  async onload() {
    const stored = await this.loadData();
    this.excludedNotesText = typeof stored?.excludedNotes === "string" ? stored.excludedNotes : "";
    this.excludedNoteNames = parseExcludedNoteNames(this.excludedNotesText);
    this.excludedTitleKeywordsText = typeof stored?.excludedTitleKeywords === "string" ? stored.excludedTitleKeywords : "";
    this.excludedTitleKeywords = parseExcludedTitleKeywords(
      this.excludedTitleKeywordsText
    );
    for (const [path, lines] of Object.entries(stored?.generatedResults ?? {})) {
      if (Array.isArray(lines) && lines.every((line) => typeof line === "string")) {
        this.generatedResults.set(path, lines);
      }
    }
    for (const [path, session] of Object.entries(stored?.filterSessions ?? {})) {
      if (session && typeof session.original === "string" && typeof session.filtered === "string") {
        this.sessions.set(path, session);
      }
    }
    for (const [path, session] of Object.entries(stored?.reviewSessions ?? {})) {
      if (session && Array.isArray(session.queue)) this.reviewSessions.set(path, session);
    }
    this.addSettingTab(new PerspectivismSettingTab(this.app, this));
    this.rememberMarkdownLeaf(this.app.workspace.activeLeaf);
    this.registerView(VIEW_TYPE, (leaf) => new PerspectivismView(leaf, this));
    this.addRibbonIcon("list-filter", "Perspectivism", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-keyword-sorter-panel",
      name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0430\u043D\u0435\u043B\u044C \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "repair-generated-results-in-current-note",
      name: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0438 \u0437\u0430\u043D\u043E\u0432\u043E \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u043E\u043A\u0438 \u0432 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0435",
      callback: () => void this.repairGeneratedResultsInCurrentNote()
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.rememberMarkdownLeaf(leaf);
        this.scheduleRefresh();
        void this.analyzeActiveNote();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.rememberMarkdownLeaf(this.app.workspace.activeLeaf);
        this.scheduleRefresh();
        void this.analyzeActiveNote();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => this.handleEditorChange())
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian.TFile && file.path === this.app.workspace.getActiveFile()?.path) {
          this.scheduleRefresh();
        }
      })
    );
    this.app.workspace.onLayoutReady(() => {
      void this.activateView();
      void this.analyzeActiveNote();
    });
  }
  onunload() {
    if (this.analysisTimer !== null) window.clearTimeout(this.analysisTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
  getExcludedNotesText() {
    return this.excludedNotesText;
  }
  async updateExcludedNotes(value) {
    this.excludedNotesText = value;
    this.excludedNoteNames = parseExcludedNoteNames(value);
    await this.persistStoredData();
    this.scheduleAnalysis();
  }
  getExcludedTitleKeywordsText() {
    return this.excludedTitleKeywordsText;
  }
  async updateExcludedTitleKeywords(value) {
    this.excludedTitleKeywordsText = value;
    this.excludedTitleKeywords = parseExcludedTitleKeywords(value);
    await this.persistStoredData();
    this.scheduleAnalysis();
  }
  getSession(path) {
    return this.sessions.get(path);
  }
  isPerspectiveOrderSortedByCount() {
    return this.sortPerspectivesByCount;
  }
  togglePerspectiveOrder() {
    this.sortPerspectivesByCount = !this.sortPerspectivesByCount;
    this.scheduleRefresh(0);
  }
  getKeywordMatchMode(path) {
    if (path) return this.sessions.get(path)?.matchMode ?? this.keywordMatchMode;
    return this.keywordMatchMode;
  }
  async setKeywordMatchMode(file, matchMode) {
    const currentMode = this.getKeywordMatchMode(file.path);
    if (currentMode === matchMode) return;
    const view = this.getTargetMarkdownView(file.path);
    if (!view || view.file?.path !== file.path) {
      new import_obsidian.Notice("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u0443\u0436\u043D\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443.");
      return;
    }
    const session = this.sessions.get(file.path);
    if (!session) {
      this.keywordMatchMode = matchMode;
      this.scheduleRefresh(0);
      return;
    }
    this.cancelActiveAnalysis();
    try {
      const transition = setKeywordFilterMode(
        view.editor.getValue(),
        session,
        matchMode,
        this.generatedResults.get(file.path) ?? []
      );
      replaceEditorTextPreservingCursor(view.editor, transition.text);
      this.sessions.set(file.path, transition.session);
      this.keywordMatchMode = matchMode;
      void this.persistStoredData();
      new import_obsidian.Notice(
        `\u0420\u0435\u0436\u0438\u043C ${matchMode === "all" ? "\u0418" : "\u0418\u041B\u0418"}. \u041D\u0430\u0432\u0435\u0440\u0445 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u043E \u0441\u0442\u0440\u043E\u043A \u2014 ${transition.matchCount}; \u0432\u043D\u0438\u0437 \u2014 ${transition.otherCount}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044E.";
      new import_obsidian.Notice(message);
    }
    this.scheduleRefresh(0);
  }
  openPerspectiveReview(file) {
    const view = this.getTargetMarkdownView(file.path);
    if (!view || view.file?.path !== file.path) {
      new import_obsidian.Notice("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u0443\u0436\u043D\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443.");
      return;
    }
    const block = findKeywordBlock(view.editor.getValue());
    if (!block || block.keywords.length === 0) {
      new import_obsidian.Notice("\u0412 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0435 \u043D\u0435\u0442 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432 \u0434\u043B\u044F \u0440\u0430\u0437\u0431\u043E\u0440\u0430.");
      return;
    }
    new PerspectiveReviewModal(this.app, this, file, block.keywords).open();
  }
  resumePerspectiveReview(file) {
    const session = this.reviewSessions.get(file.path);
    if (!session || session.currentIndex >= session.queue.length) {
      new import_obsidian.Notice("\u041D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u043E\u0433\u043E \u0440\u0430\u0437\u0431\u043E\u0440\u0430 \u043D\u0435\u0442.");
      return;
    }
    const block = findKeywordBlock(this.getOpenNoteText(file.path));
    if (!block) {
      new import_obsidian.Notice("\u0412 \u0437\u0430\u043C\u0435\u0442\u043A\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0442 \u0431\u043B\u043E\u043A\u0430 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432.");
      return;
    }
    this.perspectiveReviewPath = file.path;
    new PerspectiveReviewModal(this.app, this, file, block.keywords, session).open();
  }
  restoreOriginalOrder(file) {
    const session = this.sessions.get(file.path);
    if (!session) {
      new import_obsidian.Notice("\u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u043E\u0433\u043E \u0438\u0441\u0445\u043E\u0434\u043D\u043E\u0433\u043E \u043F\u043E\u0440\u044F\u0434\u043A\u0430 \u043D\u0435\u0442.");
      return;
    }
    const current = this.getOpenNoteText(file.path);
    if (current !== session.filtered) {
      new import_obsidian.Notice("\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E: \u043F\u043E\u0441\u043B\u0435 \u043E\u0442\u0431\u043E\u0440\u0430 \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u0431\u044B\u043B\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0430 \u0432\u0440\u0443\u0447\u043D\u0443\u044E.", 8e3);
      return;
    }
    const view = this.getTargetMarkdownView(file.path);
    if (!view) return;
    replaceEditorTextPreservingCursor(view.editor, session.original);
    this.sessions.delete(file.path);
    void this.persistStoredData();
    this.scheduleRefresh(0);
    new import_obsidian.Notice("\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0441\u0442\u0440\u043E\u043A \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.");
  }
  undoPerspectiveReview(file) {
    const session = this.reviewSessions.get(file.path);
    const action = session?.lastAction;
    if (!session || !action) {
      new import_obsidian.Notice("\u041D\u0435\u0442 \u043E\u0442\u0432\u0435\u0442\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043C\u043E\u0436\u043D\u043E \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C.");
      return;
    }
    if (this.getOpenNoteText(file.path) !== action.afterText) {
      new import_obsidian.Notice("\u041E\u0442\u043C\u0435\u043D\u0430 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430: \u043F\u043E\u0441\u043B\u0435 \u043E\u0442\u0432\u0435\u0442\u0430 \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u0431\u044B\u043B\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0430 \u0432\u0440\u0443\u0447\u043D\u0443\u044E.", 8e3);
      return;
    }
    const view = this.getTargetMarkdownView(file.path);
    if (!view) return;
    replaceEditorTextPreservingCursor(view.editor, action.beforeText);
    session.currentIndex = action.currentIndex;
    session.addedPerspectiveCount = action.addedPerspectiveCount;
    session.changedLineCount = action.changedLineCount;
    session.skippedLineCount = action.skippedLineCount;
    delete session.lastAction;
    this.reviewSessions.set(file.path, session);
    void this.persistStoredData();
    this.scheduleRefresh(0);
    new import_obsidian.Notice("\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043E\u0442\u0432\u0435\u0442 \u043E\u0442\u043C\u0435\u043D\u0451\u043D. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u25B6, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C.");
  }
  getOpenNoteText(path) {
    const view = this.getTargetMarkdownView(path);
    if (!view || view.file?.path !== path) throw new Error("\u0417\u0430\u043C\u0435\u0442\u043A\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0430.");
    return view.editor.getValue();
  }
  savePerspectiveReview(path, session) {
    this.reviewSessions.set(path, session);
    return this.persistStoredData();
  }
  setReviewLastAction(path, action) {
    const session = this.reviewSessions.get(path);
    if (session) session.lastAction = action;
    else this.reviewSessions.set(path, {
      selectedPerspectives: [],
      prioritizedPerspectives: [],
      skipLinesWithAnySelectedPerspective: true,
      queue: [],
      currentIndex: 0,
      addedPerspectiveCount: 0,
      changedLineCount: 0,
      skippedLineCount: 0,
      lastAction: action
    });
  }
  getReviewLastAction(path) {
    return this.reviewSessions.get(path)?.lastAction;
  }
  preparePerspectiveReview(file, perspectives, skipLinesWithAnySelectedPerspective) {
    const view = this.getTargetMarkdownView(file.path);
    if (!view || view.file?.path !== file.path) {
      throw new Error("\u0417\u0430\u043C\u0435\u0442\u043A\u0430 \u0440\u0430\u0437\u0431\u043E\u0440\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0430.");
    }
    this.cancelActiveAnalysis();
    const queue = collectPerspectiveReviewLines(
      view.editor.getValue(),
      perspectives,
      this.generatedResults.get(file.path) ?? [],
      skipLinesWithAnySelectedPerspective
    );
    this.perspectiveReviewPath = file.path;
    return queue;
  }
  applyPerspectiveReviewLine(file, item, perspectives) {
    const view = this.getTargetMarkdownView(file.path);
    if (!view || view.file?.path !== file.path) {
      throw new Error("\u0417\u0430\u043C\u0435\u0442\u043A\u0430 \u0440\u0430\u0437\u0431\u043E\u0440\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0430.");
    }
    if (this.perspectiveReviewPath !== file.path) {
      throw new Error("\u0420\u0435\u0436\u0438\u043C \u0440\u0430\u0437\u0431\u043E\u0440\u0430 \u0443\u0436\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D.");
    }
    if (perspectives.length === 0) return 0;
    const update = updatePerspectiveReviewLine(
      view.editor.getValue(),
      item.lineNumber,
      item.text,
      perspectives
    );
    replaceEditorTextPreservingCursor(view.editor, update.text);
    return update.addedPerspectives.length;
  }
  finishPerspectiveReview(path) {
    if (this.perspectiveReviewPath !== path) return;
    this.perspectiveReviewPath = null;
    this.scheduleRefresh(0);
    this.scheduleAnalysis(250);
  }
  getTargetMarkdownView(path) {
    const activeView = this.app.workspace.activeLeaf?.view;
    if (activeView instanceof import_obsidian.MarkdownView && activeView.file) {
      this.lastMarkdownPath = activeView.file.path;
      if (!path || activeView.file.path === path) return activeView;
    }
    const targetPath = path ?? this.lastMarkdownPath;
    const markdownViews = this.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view).filter((view) => view instanceof import_obsidian.MarkdownView && view.file !== null);
    if (targetPath) {
      const target = markdownViews.find((view) => view.file?.path === targetPath);
      if (target) return target;
    }
    const fallback = markdownViews[0] ?? null;
    if (fallback?.file) this.lastMarkdownPath = fallback.file.path;
    return fallback;
  }
  async toggleKeyword(file, keyword) {
    const view = this.getTargetMarkdownView(file.path);
    if (!view || view.file?.path !== file.path) {
      new import_obsidian.Notice("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u0443\u0436\u043D\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443.");
      return;
    }
    this.cancelActiveAnalysis();
    const current = view.editor.getValue();
    const session = this.sessions.get(file.path);
    try {
      const transition = toggleKeywordFilter(
        current,
        session,
        keyword,
        this.generatedResults.get(file.path) ?? [],
        session?.matchMode ?? this.keywordMatchMode
      );
      replaceEditorTextPreservingCursor(view.editor, transition.text);
      if (transition.session) {
        this.sessions.set(file.path, transition.session);
        void this.persistStoredData();
        new import_obsidian.Notice(
          `\u0412\u044B\u0431\u0440\u0430\u043D\u044B \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u044B: ${transition.session.activeKeywords.join(", ")}. \u0420\u0435\u0436\u0438\u043C \u2014 ${transition.session.matchMode === "all" ? "\u0418" : "\u0418\u041B\u0418"}. \u041D\u0430\u0432\u0435\u0440\u0445 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u043E \u0441\u0442\u0440\u043E\u043A \u2014 ${transition.matchCount}; \u0432\u043D\u0438\u0437 \u2014 ${transition.otherCount}.`
        );
      } else {
        this.sessions.delete(file.path);
        void this.persistStoredData();
        if (transition.outcome === "disabled-after-edit") {
          new import_obsidian.Notice(
            "\u041E\u0442\u0431\u043E\u0440 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D. \u0412\u043D\u0435\u0441\u0451\u043D\u043D\u044B\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0438 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0441\u0442\u0440\u043E\u043A \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B."
          );
        } else {
          new import_obsidian.Notice("\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0441\u0442\u0440\u043E\u043A \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.");
        }
        this.scheduleAnalysis(0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443.";
      new import_obsidian.Notice(message);
    }
    this.scheduleRefresh(0);
  }
  async analyzeActiveNote() {
    const view = this.getTargetMarkdownView();
    const target = view?.file;
    if (!view || !target || target.extension !== "md") return;
    const path = target.path;
    if (this.sessions.has(path)) return;
    if (this.perspectiveReviewPath === path) return;
    const sequence = ++this.analysisSequence;
    this.analysisPath = path;
    const current = view.editor.getValue();
    const block = findKeywordBlock(current);
    this.scanDirectiveStates.set(path, block?.scanEnabled ?? false);
    this.scanConfigurationStates.set(
      path,
      block?.scanEnabled ? JSON.stringify([block.lineTemplate, block.keywords]) : ""
    );
    if (!block || block.keywords.length === 0) return;
    if (!block.scanEnabled) return;
    const collectedMatches = [];
    const files = this.app.vault.getMarkdownFiles();
    for (let index = 0; index < files.length; index += 1) {
      if (sequence !== this.analysisSequence || this.analysisPath !== path) return;
      const file = files[index];
      if (file === target || file.path === path) continue;
      if (isObsidianConfigPath(file.path, this.app.vault.configDir)) continue;
      if (isExcludedNotePath(file.path, this.excludedNoteNames)) continue;
      if (titleContainsExcludedKeyword(file.path, this.excludedTitleKeywords)) continue;
      try {
        const sourceSession = this.sessions.get(file.path);
        const text = sourceSession?.original ?? await this.app.vault.cachedRead(file);
        if (findKeywordBlock(text)) continue;
        collectedMatches.push(
          ...collectMatchingLines(
            text,
            block.keywords,
            file.path,
            this.generatedResults.get(file.path) ?? []
          )
        );
      } catch {
      }
      if (index > 0 && index % 100 === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    const matches = formatUniqueCollectedLines(
      collectedMatches,
      block.lineTemplate
    );
    if (matches.length > MAX_GENERATED_RESULTS) {
      new import_obsidian.Notice(
        `\u0410\u043D\u0430\u043B\u0438\u0437 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D: \u043D\u0430\u0439\u0434\u0435\u043D\u043E ${matches.length} \u0441\u0442\u0440\u043E\u043A. \u0417\u0430\u0449\u0438\u0442\u043D\u044B\u0439 \u043F\u0440\u0435\u0434\u0435\u043B \u2014 ${MAX_GENERATED_RESULTS}; \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0430.`,
        1e4
      );
      return;
    }
    if (sequence !== this.analysisSequence || this.analysisPath !== path) return;
    if (this.sessions.has(path)) return;
    const liveView = this.getTargetMarkdownView(path);
    if (!liveView || liveView.file?.path !== path) return;
    const liveText = liveView.editor.getValue();
    const liveBlock = findKeywordBlock(liveText);
    if (!liveBlock || !liveBlock.scanEnabled) return;
    let updated;
    try {
      updated = replaceGeneratedResults(
        liveText,
        matches,
        this.generatedResults.get(path) ?? []
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E, \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u0432\u0430\u0442\u044C \u0434\u0443\u0431\u043B\u0438\u043A\u0430\u0442\u044B.";
      new import_obsidian.Notice(message, 12e3);
      return;
    }
    if (updated !== liveText) {
      replaceEditorTextPreservingCursor(liveView.editor, updated);
      new import_obsidian.Notice(`\u0410\u043D\u0430\u043B\u0438\u0437 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D: \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0441\u0442\u0440\u043E\u043A \u2014 ${matches.length}.`);
    }
    this.generatedResults.set(path, matches);
    await this.persistStoredData();
    this.scheduleRefresh(0);
  }
  async repairGeneratedResultsInCurrentNote() {
    const view = this.getTargetMarkdownView();
    const file = view?.file;
    if (!view || !file || file.extension !== "md") {
      new import_obsidian.Notice("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u0443\u0436\u043D\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 Markdown.");
      return;
    }
    const block = findKeywordBlock(view.editor.getValue());
    if (!block?.scanEnabled) {
      new import_obsidian.Notice("\u0421\u0431\u043E\u0440 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D: \u0434\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0441\u0442\u0440\u043E\u043A\u0443 scan on \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u0441\u043B\u0435 \u0448\u0430\u0431\u043B\u043E\u043D\u0430 p.");
      return;
    }
    const confirmed = window.confirm(
      "\u041F\u043B\u0430\u0433\u0438\u043D \u0443\u0434\u0430\u043B\u0438\u0442 \u0432\u0441\u0435 \u044D\u043A\u0437\u0435\u043C\u043F\u043B\u044F\u0440\u044B \u0440\u0430\u043D\u0435\u0435 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0438 \u0437\u0430\u043D\u043E\u0432\u043E \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0445 \u0441\u0442\u0440\u043E\u043A, \u0430 \u0437\u0430\u0442\u0435\u043C \u0432\u0441\u0442\u0430\u0432\u0438\u0442 \u043F\u043E \u043E\u0434\u043D\u043E\u043C\u0443 \u044D\u043A\u0437\u0435\u043C\u043F\u043B\u044F\u0440\u0443 \u043A\u0430\u0436\u0434\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0438. \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C?"
    );
    if (!confirmed) return;
    this.cancelActiveAnalysis();
    this.sessions.delete(file.path);
    new import_obsidian.Notice(
      "\u041D\u0430\u0447\u0438\u043D\u0430\u044E \u043F\u043E\u043B\u043D\u0443\u044E \u043F\u0435\u0440\u0435\u0441\u0431\u043E\u0440\u043A\u0443 \u0431\u0435\u0437 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u044E\u0449\u0438\u0445\u0441\u044F \u0441\u0442\u0440\u043E\u043A.",
      6e3
    );
    await this.analyzeActiveNote();
  }
  cancelActiveAnalysis() {
    this.analysisSequence += 1;
    this.analysisPath = null;
  }
  persistStoredData() {
    const snapshot = {
      generatedResults: Object.fromEntries(this.generatedResults),
      filterSessions: Object.fromEntries(this.sessions),
      reviewSessions: Object.fromEntries(this.reviewSessions),
      excludedNotes: this.excludedNotesText,
      excludedTitleKeywords: this.excludedTitleKeywordsText
    };
    this.savePromise = this.savePromise.catch(() => void 0).then(() => this.saveData(snapshot));
    return this.savePromise;
  }
  scheduleRefresh(delay = 120) {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        const view = leaf.view;
        if (view instanceof PerspectivismView) view.requestRefresh();
      }
    }, delay);
  }
  scheduleAnalysis(delay = 300) {
    if (this.analysisTimer !== null) window.clearTimeout(this.analysisTimer);
    this.analysisTimer = window.setTimeout(() => {
      this.analysisTimer = null;
      void this.analyzeActiveNote();
    }, delay);
  }
  handleEditorChange() {
    this.scheduleRefresh();
    const view = this.getTargetMarkdownView();
    const file = view?.file;
    if (!view || !file) return;
    const block = findKeywordBlock(view.editor.getValue());
    const scanEnabled = block?.scanEnabled ?? false;
    const scanConfiguration = scanEnabled ? JSON.stringify([block?.lineTemplate ?? "", block?.keywords ?? []]) : "";
    const wasEnabled = this.scanDirectiveStates.get(file.path) ?? false;
    const previousConfiguration = this.scanConfigurationStates.get(file.path) ?? "";
    this.scanDirectiveStates.set(file.path, scanEnabled);
    this.scanConfigurationStates.set(file.path, scanConfiguration);
    if (wasEnabled && !scanEnabled) {
      this.cancelActiveAnalysis();
      return;
    }
    if (scanEnabled && (!wasEnabled || scanConfiguration !== previousConfiguration)) {
      this.scheduleAnalysis(300);
    }
  }
  rememberMarkdownLeaf(leaf) {
    const view = leaf?.view;
    if (view instanceof import_obsidian.MarkdownView && view.file) {
      this.lastMarkdownPath = view.file.path;
    }
  }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new import_obsidian.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u0430\u0432\u0443\u044E \u043F\u0430\u043D\u0435\u043B\u044C.");
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }
};
var PerspectivismSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  plugin;
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("\u0418\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u044B\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0438").setDesc(
      "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u044F \u0437\u0430\u043C\u0435\u0442\u043E\u043A, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043D\u0435 \u043D\u0430\u0434\u043E \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043A\u0430\u043A \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0438 \u043F\u0440\u0438 \u043F\u043E\u0438\u0441\u043A\u0435. \u041A\u0430\u0436\u0434\u043E\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043D\u0430 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0435; \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 .md \u043D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E."
    ).addTextArea((textArea) => {
      textArea.setPlaceholder("\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A\n\u0410\u0440\u0445\u0438\u0432\n\u0428\u0430\u0431\u043B\u043E\u043D\u044B").setValue(this.plugin.getExcludedNotesText()).onChange(async (value) => {
        await this.plugin.updateExcludedNotes(value);
      });
      textArea.inputEl.rows = 10;
      textArea.inputEl.addClass("perspectivism-excluded-notes");
    });
    new import_obsidian.Setting(containerEl).setName("\u0418\u0441\u043A\u043B\u044E\u0447\u0451\u043D\u043D\u044B\u0435 \u0441\u043B\u043E\u0432\u0430 \u0432 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F\u0445").setDesc(
      "\u0421\u043B\u043E\u0432\u0430 \u0438\u043B\u0438 \u0444\u0440\u0430\u0437\u044B, \u043F\u0440\u0438 \u043D\u0430\u043B\u0438\u0447\u0438\u0438 \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u0432 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0438 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u043E\u043D\u0430 \u043D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u043A\u0430\u043A \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u043F\u0440\u0438 \u043F\u043E\u0438\u0441\u043A\u0435. \u041A\u0430\u0436\u0434\u043E\u0435 \u0441\u043B\u043E\u0432\u043E \u0438\u043B\u0438 \u0444\u0440\u0430\u0437\u0430 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043D\u0430 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0435."
    ).addTextArea((textArea) => {
      textArea.setPlaceholder("\u0430\u0440\u0445\u0438\u0432\n\u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A\n\u0441\u0442\u0430\u0440\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F").setValue(this.plugin.getExcludedTitleKeywordsText()).onChange(async (value) => {
        await this.plugin.updateExcludedTitleKeywords(value);
      });
      textArea.inputEl.rows = 10;
      textArea.inputEl.addClass("perspectivism-excluded-title-keywords");
    });
  }
};
