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
  default: () => TermIntervalReviewPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/settings.ts
var DEFAULT_SETTINGS = {
  bedtime: "20:00",
  wakeTime: "06:00"
};
var activeSettings = { ...DEFAULT_SETTINGS };
function normalizeClockTime(value, fallback) {
  if (typeof value !== "string") return fallback;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
function normalizeSettings(settings) {
  return {
    bedtime: normalizeClockTime(settings?.bedtime, DEFAULT_SETTINGS.bedtime),
    wakeTime: normalizeClockTime(settings?.wakeTime, DEFAULT_SETTINGS.wakeTime)
  };
}
function applySettings(settings) {
  activeSettings = normalizeSettings(settings);
}
function clockTimeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
function getActiveSleepWindowEnd(now) {
  const bedtime = clockTimeToMinutes(activeSettings.bedtime);
  const wakeTime = clockTimeToMinutes(activeSettings.wakeTime);
  if (bedtime === wakeTime) return null;
  const current = new Date(now);
  const currentMinutes = current.getHours() * 60 + current.getMinutes() + current.getSeconds() / 60;
  const crossesMidnight = bedtime > wakeTime;
  const insideSleepWindow = crossesMidnight ? currentMinutes >= bedtime || currentMinutes < wakeTime : currentMinutes >= bedtime && currentMinutes < wakeTime;
  if (!insideSleepWindow) return null;
  const wakeHours = Math.floor(wakeTime / 60);
  const wakeMinutes = wakeTime % 60;
  const windowEnd = new Date(current);
  windowEnd.setHours(wakeHours, wakeMinutes, 0, 0);
  if (windowEnd.getTime() <= now) windowEnd.setDate(windowEnd.getDate() + 1);
  return windowEnd.getTime();
}

// src/display.ts
function formatCardTextForDisplay(text) {
  return text.replaceAll("**", "");
}
var formatTermForDisplay = formatCardTextForDisplay;
function renderMultiPinIcon(button) {
  button.empty();
  const group = button.createSpan({ cls: "tir-multi-pin-icon" });
  group.setAttribute("aria-hidden", "true");
  for (let index = 1; index <= 3; index += 1) {
    const pin = group.createSpan({ cls: `tir-multi-pin-part tir-multi-pin-part-${index}` });
    (0, import_obsidian.setIcon)(pin, "pin");
  }
}

// src/parser.ts
var FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
var BOLD_DEFINITION_PATTERN = /\*\*([^*\r\n]+?)\*\*/gu;
var DEFINITION_DELIMITER = "\u2014";
function parseTermLines(content) {
  const lines = content.split(/\r?\n/u);
  const parsed = [];
  const occurrences = /* @__PURE__ */ new Map();
  let inFrontmatter = lines[0]?.trim() === "---";
  let fenceCharacter = null;
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (inFrontmatter) {
      if (index > 0 && (trimmed === "---" || trimmed === "...")) inFrontmatter = false;
      continue;
    }
    const fence = line.match(FENCE_PATTERN)?.[1];
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
    for (const match of line.matchAll(BOLD_DEFINITION_PATTERN)) {
      const content2 = match[1] ?? "";
      const delimiter = content2.indexOf(DEFINITION_DELIMITER);
      if (delimiter <= 0) continue;
      const term = content2.slice(0, delimiter).trim();
      const definition = content2.slice(delimiter + DEFINITION_DELIMITER.length).trim();
      if (term.length === 0 || definition.length === 0) continue;
      const occurrence = occurrences.get(term) ?? 0;
      occurrences.set(term, occurrence + 1);
      parsed.push({ term, definition, occurrence, line: index + 1 });
    }
  }
  return parsed;
}

// src/scheduler.ts
var SECOND = 1e3;
var MINUTE = 60 * SECOND;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;
var REVIEW_INTERVALS = [
  5 * SECOND,
  15 * SECOND,
  45 * SECOND,
  2 * MINUTE,
  6 * MINUTE,
  18 * MINUTE,
  54 * MINUTE,
  2 * HOUR + 40 * MINUTE,
  8 * HOUR,
  24 * HOUR,
  3 * DAY,
  9 * DAY
];
var FREE_WINDOW = 2 * MINUTE;
var REST_WINDOW = 6 * MINUTE;
function clampStage(stage) {
  if (!Number.isFinite(stage)) return 0;
  return Math.max(0, Math.min(Math.trunc(stage), REVIEW_INTERVALS.length - 1));
}
function scheduleCorrect(card, now) {
  const currentStage = clampStage(card.stage);
  const nextStage = Math.min(currentStage + 1, REVIEW_INTERVALS.length - 1);
  const interval = REVIEW_INTERVALS[nextStage] ?? REVIEW_INTERVALS[0];
  return {
    ...card,
    stage: nextStage,
    dueAt: now + interval,
    updatedAt: now,
    lastReviewedAt: now,
    correctCount: card.correctCount + 1
  };
}
function scheduleIncorrect(card, now) {
  return {
    ...card,
    stage: 0,
    dueAt: now + REVIEW_INTERVALS[0],
    updatedAt: now,
    lastReviewedAt: now,
    incorrectCount: card.incorrectCount + 1
  };
}
function isSleepWindowEarlyReview(card, now) {
  const sleepWindowEnd = getActiveSleepWindowEnd(now);
  return sleepWindowEnd !== null && card.dueAt > now && card.dueAt <= sleepWindowEnd;
}
function isAvailable(card, now) {
  return card.dueAt <= now || isSleepWindowEarlyReview(card, now);
}
function compareCardsByDueTime(left, right) {
  return left.dueAt - right.dueAt || left.term.localeCompare(right.term, "ru");
}
function partitionCards(cards, now) {
  const available = [];
  const upcoming = [];
  for (const card of cards) {
    (isAvailable(card, now) ? available : upcoming).push(card);
  }
  available.sort(compareCardsByDueTime);
  upcoming.sort(compareCardsByDueTime);
  return { available, upcoming };
}
function getQueueActivity(cards, now) {
  const hasWithin = (window2) => cards.some((card) => card.dueAt <= now + window2);
  return {
    availability: hasWithin(FREE_WINDOW) ? "busy" : "free",
    pace: hasWithin(REST_WINDOW) ? "work" : "rest"
  };
}
function formatDuration(milliseconds) {
  const value = Math.max(0, Math.ceil(milliseconds / SECOND) * SECOND);
  if (value < MINUTE) return `${Math.ceil(value / SECOND)} \u0441`;
  if (value < HOUR) {
    const minutes = Math.floor(value / MINUTE);
    const seconds = Math.ceil(value % MINUTE / SECOND);
    return seconds > 0 ? `${minutes} \u043C\u0438\u043D ${seconds} \u0441` : `${minutes} \u043C\u0438\u043D`;
  }
  if (value < DAY) {
    const hours2 = Math.floor(value / HOUR);
    const minutes = Math.ceil(value % HOUR / MINUTE);
    return minutes > 0 ? `${hours2} \u0447 ${minutes} \u043C\u0438\u043D` : `${hours2} \u0447`;
  }
  const days = Math.floor(value / DAY);
  const hours = Math.ceil(value % DAY / HOUR);
  return hours > 0 ? `${days} \u0434 ${hours} \u0447` : `${days} \u0434`;
}
function stageIntervalLabel(stage) {
  return formatDuration(REVIEW_INTERVALS[clampStage(stage)] ?? REVIEW_INTERVALS[0]);
}
function formatCardDueTime(dueAt, available, now) {
  if (!available) return `\u0447\u0435\u0440\u0435\u0437 ${formatDuration(dueAt - now)}`;
  return dueAt <= now ? `\u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E \u043D\u0430 ${formatDuration(now - dueAt)}` : `\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0434\u043E \u043F\u043E\u0434\u044A\u0451\u043C\u0430 \xB7 \u0447\u0435\u0440\u0435\u0437 ${formatDuration(dueAt - now)}`;
}

// src/queue.ts
function compareCardsWithPins(left, right, pinnedCardIds) {
  const leftPinned = pinnedCardIds.has(left.id);
  const rightPinned = pinnedCardIds.has(right.id);
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
  return compareCardsByDueTime(left, right);
}
function partitionCardsByPriority(cards, urgentSourcePaths, pinnedCardIds, now) {
  const { available, upcoming } = partitionCards([...cards], now);
  const urgentAvailable = [];
  const regularAvailable = [];
  for (const card of available) {
    (urgentSourcePaths.has(card.sourcePath) ? urgentAvailable : regularAvailable).push(card);
  }
  urgentAvailable.sort((left, right) => compareCardsWithPins(left, right, pinnedCardIds));
  regularAvailable.sort(compareCardsByDueTime);
  return { urgentAvailable, regularAvailable, upcoming };
}
function getAutomaticReviewQueue(cards, urgentSourcePaths, pinnedCardIds, now) {
  const { urgentAvailable, regularAvailable } = partitionCardsByPriority(
    cards,
    urgentSourcePaths,
    pinnedCardIds,
    now
  );
  return urgentSourcePaths.size > 0 ? urgentAvailable : regularAvailable;
}
function getNoteTitle(sourcePath) {
  const filename = sourcePath.split("/").at(-1) ?? sourcePath;
  return filename.replace(/\.md$/iu, "");
}
function normalizeSearchText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("\u0451", "\u0435").replace(/\s+/gu, " ").trim();
}
function getSearchWords(value) {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}
function getEditDistance(left, right) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? leftIndex) + 1,
        (previous[rightIndex] ?? rightIndex) + 1,
        (previous[rightIndex - 1] ?? rightIndex - 1) + substitutionCost
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length] ?? right.length;
}
function scoreSearchText(value, query) {
  if (value === query) return 1e4;
  if (value.startsWith(query)) return 9e3 - Math.min(value.length - query.length, 500);
  const words = getSearchWords(value);
  if (words.includes(query)) return 8500;
  const wordPrefix = words.filter((word) => word.startsWith(query)).sort((left, right) => left.length - right.length)[0];
  if (wordPrefix) return 8e3 - Math.min(wordPrefix.length - query.length, 500);
  const position = value.indexOf(query);
  if (position >= 0) return 7e3 - Math.min(position, 500);
  if (query.length < 3) return null;
  const allowedEdits = query.length <= 4 ? 1 : Math.max(1, Math.floor(query.length * 0.28));
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of [value, ...words]) {
    if (Math.abs(candidate.length - query.length) > allowedEdits) continue;
    closestDistance = Math.min(closestDistance, getEditDistance(candidate, query));
  }
  if (closestDistance > allowedEdits) return null;
  return 5e3 - closestDistance * 250;
}
function scoreCardSearch(card, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return 0;
  const term = normalizeSearchText(formatTermForDisplay(card.term));
  const noteTitle = normalizeSearchText(getNoteTitle(card.sourcePath));
  const termScore = scoreSearchText(term, normalizedQuery);
  const noteScore = scoreSearchText(noteTitle, normalizedQuery);
  if (termScore === null && noteScore === null) return null;
  return Math.max(termScore === null ? -1 : termScore + 100, noteScore ?? -1);
}

// src/review-flow.ts
var FOLLOW_UP_WAIT_WINDOW = 15e3;
function getReviewNavigation(cards, currentCardId, urgentSourcePaths, pinnedCardIds, now) {
  const available = getAutomaticReviewQueue(cards, urgentSourcePaths, pinnedCardIds, now);
  const currentIndex = available.findIndex((card) => card.id === currentCardId);
  if (currentIndex < 0) {
    return { previousCardId: null, nextCardId: null };
  }
  return {
    previousCardId: available[currentIndex - 1]?.id ?? null,
    nextCardId: available[currentIndex + 1]?.id ?? null
  };
}
function chooseReviewCompletionAction(cards, completedCardId, forceWait, urgentSourcePaths, pinnedCardIds, now) {
  const nextAvailable = getAutomaticReviewQueue(cards, urgentSourcePaths, pinnedCardIds, now).find(
    (card) => card.id !== completedCardId
  );
  if (nextAvailable) return { type: "open", cardId: nextAvailable.id };
  const automaticCards = urgentSourcePaths.size > 0 ? cards.filter((card) => urgentSourcePaths.has(card.sourcePath)) : cards;
  const nearest = automaticCards.reduce((current, card) => {
    if (current === null) return card;
    if (card.dueAt !== current.dueAt) return card.dueAt < current.dueAt ? card : current;
    return card.term.localeCompare(current.term, "ru") < 0 ? card : current;
  }, null);
  if (nearest && (forceWait || nearest.dueAt - now <= FOLLOW_UP_WAIT_WINDOW)) {
    return { type: "wait", cardId: nearest.id, dueAt: nearest.dueAt };
  }
  return { type: "close" };
}

// src/file-state.ts
function createFileScanState(stat) {
  return { mtime: stat.mtime, size: stat.size };
}
function isSameFileState(left, right) {
  return left?.mtime === right.mtime && left.size === right.size;
}
function pruneFileStates(states, existingPaths) {
  const next = {};
  let changed = false;
  for (const [path, state] of Object.entries(states)) {
    if (existingPaths.has(path)) next[path] = state;
    else changed = true;
  }
  return { states: next, changed };
}

// src/main.ts
var QUEUE_VIEW_TYPE = "term-interval-review-queue";
var CARD_VIEW_TYPE = "term-interval-review-card";
var SAVE_DELAY = 650;
var STARTUP_SCAN_DELAY = 6e3;
var SCAN_YIELD_EVERY = 6;
function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function isReviewCard(value) {
  if (!value || typeof value !== "object") return false;
  const card = value;
  return typeof card.id === "string" && typeof card.term === "string" && typeof card.definition === "string" && typeof card.sourcePath === "string" && typeof card.occurrence === "number" && typeof card.stage === "number" && typeof card.dueAt === "number";
}
function isFileScanState(value) {
  if (!value || typeof value !== "object") return false;
  const state = value;
  return typeof state.mtime === "number" && Number.isFinite(state.mtime) && typeof state.size === "number" && Number.isFinite(state.size);
}
function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}
var QueueView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  plugin;
  structureSignature = "";
  searchQuery = "";
  getViewType() {
    return QUEUE_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u041F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u0435 \u0442\u0435\u0440\u043C\u0438\u043D\u043E\u0432";
  }
  getIcon() {
    return "brain";
  }
  async onOpen() {
    this.refresh(true);
  }
  refresh(force = false) {
    const now = Date.now();
    const partition = partitionCardsByPriority(
      this.plugin.cards,
      this.plugin.urgentSourcePaths,
      this.plugin.pinnedCardIds,
      now
    );
    const { urgentAvailable, regularAvailable, upcoming } = partition;
    const availableCount = urgentAvailable.length + regularAvailable.length;
    const cardSignature = (card) => `${card.id}@${card.dueAt}`;
    const signature = `urgent:${urgentAvailable.map(cardSignature).join(",")}|regular:${regularAvailable.map(cardSignature).join(",")}|upcoming:${upcoming.map(cardSignature).join(",")}|pinned:${[...this.plugin.pinnedCardIds].sort().join(",")}`;
    if (!force && signature === this.structureSignature) {
      this.updateTimeLabels(now);
      return;
    }
    this.structureSignature = signature;
    const root = this.contentEl;
    const previousScroll = root.scrollTop;
    root.empty();
    root.addClass("tir-queue");
    const header = root.createDiv({ cls: "tir-queue-header" });
    header.createEl("h3", { text: "\u041F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u0435" });
    header.createSpan({
      cls: availableCount > 0 ? "tir-count tir-count-active" : "tir-count",
      text: String(availableCount),
      attr: {
        "aria-label": `\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A: ${availableCount}`,
        "data-queue-count": "true"
      }
    });
    const activity = root.createDiv({ cls: "tir-queue-activity" });
    activity.createSpan({
      cls: "tir-activity-state",
      text: "",
      attr: {
        "data-activity-kind": "availability",
        title: "\u0415\u0441\u0442\u044C \u043B\u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u044F \u0432 \u0431\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0435 2 \u043C\u0438\u043D\u0443\u0442\u044B"
      }
    });
    activity.createSpan({
      cls: "tir-activity-state",
      text: "",
      attr: {
        "data-activity-kind": "pace",
        title: "\u0415\u0441\u0442\u044C \u043B\u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u044F \u0432 \u0431\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0435 6 \u043C\u0438\u043D\u0443\u0442"
      }
    });
    this.updateActivityStates(now);
    const search = root.createEl("input", {
      cls: "tir-search",
      type: "search",
      value: this.searchQuery,
      placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0442\u0435\u0440\u043C\u0438\u043D\u0443 \u0438\u043B\u0438 \u0437\u0430\u043C\u0435\u0442\u043A\u0435\u2026",
      attr: { "aria-label": "\u041F\u043E\u0438\u0441\u043A \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0439 \u043F\u043E \u0442\u0435\u0440\u043C\u0438\u043D\u0443 \u0438\u043B\u0438 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0438" }
    });
    search.addEventListener("input", () => {
      this.searchQuery = search.value;
      this.applySearchFilter();
    });
    if (urgentAvailable.length > 0) {
      this.createSection(
        root,
        "\u041D\u0430\u0434\u043E \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u0441\u0440\u043E\u0447\u043D\u043E",
        "urgent",
        urgentAvailable,
        true,
        now,
        "\u0421\u0440\u043E\u0447\u043D\u044B\u0445 \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u0439 \u043D\u0435\u0442",
        "tir-urgent-section"
      );
    }
    this.createSection(
      root,
      "\u041D\u0430\u0434\u043E \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C",
      "regular",
      regularAvailable,
      true,
      now,
      "\u0421\u0435\u0439\u0447\u0430\u0441 \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u0439 \u043D\u0435\u0442"
    );
    this.createSection(
      root,
      "\u041F\u043E\u0437\u0436\u0435",
      "upcoming",
      upcoming,
      false,
      now,
      "\u0411\u0443\u0434\u0443\u0449\u0438\u0445 \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u0439 \u043D\u0435\u0442",
      "tir-upcoming-section"
    );
    this.applySearchFilter();
    root.scrollTop = previousScroll;
  }
  tick() {
    this.refresh(false);
  }
  updateTimeLabels(now) {
    for (const time of this.contentEl.querySelectorAll(".tir-time[data-due-at]")) {
      const dueAt = Number(time.dataset.dueAt);
      if (!Number.isFinite(dueAt)) continue;
      time.setText(formatCardDueTime(dueAt, time.dataset.available === "true", now));
    }
    this.updateActivityStates(now);
  }
  updateActivityStates(now) {
    const state = getQueueActivity(this.plugin.cards, now);
    const availability = this.contentEl.querySelector(
      '[data-activity-kind="availability"]'
    );
    const pace = this.contentEl.querySelector('[data-activity-kind="pace"]');
    if (availability) {
      const isFree = state.availability === "free";
      availability.setText(isFree ? "\u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E" : "\u0437\u0430\u043D\u044F\u0442\u043E");
      availability.classList.toggle("tir-activity-calm", isFree);
      availability.classList.toggle("tir-activity-active", !isFree);
    }
    if (pace) {
      const isRest = state.pace === "rest";
      pace.setText(isRest ? "\u043E\u0442\u0434\u044B\u0445" : "\u0440\u0430\u0431\u043E\u0442\u0430");
      pace.classList.toggle("tir-activity-calm", isRest);
      pace.classList.toggle("tir-activity-active", !isRest);
    }
  }
  createSection(root, title, kind, cards, available, now, emptyText, extraClass = "") {
    const section = root.createDiv({ cls: `tir-section ${extraClass}`.trim() });
    section.dataset.sectionKind = kind;
    const sectionTitle = section.createDiv({ cls: "tir-section-title" });
    sectionTitle.createSpan({ text: title });
    sectionTitle.createSpan({
      cls: "tir-section-number",
      text: String(cards.length),
      attr: { "data-section-count": kind }
    });
    const list = section.createDiv({ cls: "tir-list" });
    for (const card of cards) this.createCardEntry(list, card, available, kind, now);
    const empty = list.createDiv({
      cls: "tir-empty",
      text: emptyText,
      attr: {
        "data-section-empty": kind,
        "data-default-empty-text": emptyText
      }
    });
    empty.hidden = cards.length > 0;
  }
  createCardEntry(list, card, available, kind, now) {
    const entry = list.createDiv({ cls: "tir-card-entry" });
    entry.dataset.cardId = card.id;
    entry.dataset.sectionKind = kind;
    entry.dataset.baseOrder = String(list.childElementCount);
    const content = available ? entry.createEl("button", { cls: "tir-term-button" }) : entry.createDiv({ cls: "tir-term-row" });
    content.createSpan({ cls: "tir-term", text: formatTermForDisplay(card.term) });
    const time = content.createSpan({
      cls: available ? "tir-time tir-time-due" : "tir-time",
      text: formatCardDueTime(card.dueAt, available, now)
    });
    time.dataset.dueAt = String(card.dueAt);
    time.dataset.available = String(available);
    if (available) {
      content.addEventListener("click", () => {
        void this.plugin.openCard(card.id);
      });
    }
    const isUrgent = this.plugin.isUrgentSource(card.sourcePath);
    if (isUrgent) {
      const actions = entry.createDiv({ cls: "tir-entry-actions" });
      const remove = actions.createEl("button", {
        cls: "tir-urgent-toggle tir-urgent-remove is-active",
        text: "\u0423\u0431\u0440\u0430\u0442\u044C",
        attr: {
          type: "button",
          "aria-label": `\u0423\u0431\u0440\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${card.sourcePath} \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445`,
          title: "\u0423\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445"
        }
      });
      remove.addEventListener("click", () => {
        void this.plugin.toggleUrgentSource(card.sourcePath);
      });
      const isPinned = this.plugin.isPinnedCard(card.id);
      const pin = actions.createEl("button", {
        cls: isPinned ? "tir-pin-toggle is-active" : "tir-pin-toggle",
        attr: {
          type: "button",
          "aria-label": isPinned ? `\u041E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 ${formatTermForDisplay(card.term)}` : `\u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 ${formatTermForDisplay(card.term)}`,
          "aria-pressed": String(isPinned),
          title: isPinned ? "\u041E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443" : "\u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443"
        }
      });
      (0, import_obsidian.setIcon)(pin, "pin");
      pin.addEventListener("click", () => {
        void this.plugin.togglePinnedCard(card.id);
      });
    } else {
      const priority = entry.createEl("button", {
        cls: "tir-urgent-toggle tir-multi-pin-toggle",
        attr: {
          type: "button",
          "aria-label": `\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${card.sourcePath} \u0432 \u0441\u0440\u043E\u0447\u043D\u044B\u0435`,
          "aria-pressed": "false",
          title: "\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u0432\u0441\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0441\u0440\u043E\u0447\u043D\u043E\u0439"
        }
      });
      renderMultiPinIcon(priority);
      priority.addEventListener("click", () => {
        void this.plugin.toggleUrgentSource(card.sourcePath);
      });
    }
  }
  applySearchFilter() {
    const query = this.searchQuery;
    const visibleCounts = /* @__PURE__ */ new Map();
    const isSearching = query.trim().length > 0;
    for (const section of this.contentEl.querySelectorAll(
      ".tir-section[data-section-kind]"
    )) {
      const kind = section.dataset.sectionKind ?? "";
      const list = section.querySelector(".tir-list");
      if (!list) continue;
      const rankedEntries = Array.from(
        list.querySelectorAll(":scope > .tir-card-entry")
      ).map((entry) => {
        const card = entry.dataset.cardId ? this.plugin.getCard(entry.dataset.cardId) : void 0;
        const score = card ? scoreCardSearch(card, query) : null;
        const visible = score !== null;
        entry.hidden = !visible;
        return {
          entry,
          score,
          baseOrder: Number(entry.dataset.baseOrder ?? Number.MAX_SAFE_INTEGER)
        };
      });
      rankedEntries.sort((left, right) => {
        if (!isSearching) return left.baseOrder - right.baseOrder;
        if (left.score === null && right.score !== null) return 1;
        if (left.score !== null && right.score === null) return -1;
        return (right.score ?? 0) - (left.score ?? 0) || left.baseOrder - right.baseOrder;
      });
      for (const { entry } of rankedEntries) list.append(entry);
      const empty = section.querySelector("[data-section-empty]");
      if (empty) list.append(empty);
      const visibleCount = rankedEntries.filter(({ entry }) => !entry.hidden).length;
      visibleCounts.set(kind, visibleCount);
      const counter = section.querySelector("[data-section-count]");
      if (counter) counter.setText(String(visibleCount));
      if (empty) {
        empty.hidden = visibleCount > 0;
        empty.setText(
          isSearching ? "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" : empty.dataset.defaultEmptyText ?? "\u041A\u0430\u0440\u0442\u043E\u0447\u0435\u043A \u043D\u0435\u0442"
        );
      }
    }
    const queueCount = this.contentEl.querySelector("[data-queue-count]");
    if (queueCount) {
      const count = (visibleCounts.get("urgent") ?? 0) + (visibleCounts.get("regular") ?? 0);
      queueCount.setText(String(count));
      queueCount.setAttribute("aria-label", `\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A: ${count}`);
      queueCount.classList.toggle("tir-count-active", count > 0);
    }
  }
  clearSearch() {
    this.searchQuery = "";
    const search = this.contentEl.querySelector(".tir-search");
    if (search) search.value = "";
  }
};
var ReviewView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  plugin;
  cardId = null;
  waitingFor = null;
  transitionPending = false;
  getViewType() {
    return CARD_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0442\u0435\u0440\u043C\u0438\u043D\u0430";
  }
  getIcon() {
    return "graduation-cap";
  }
  getState() {
    return { cardId: this.cardId };
  }
  async setState(state, result) {
    await super.setState(state, result);
    const candidate = state && typeof state === "object" ? state.cardId : null;
    this.cardId = typeof candidate === "string" ? candidate : null;
    this.waitingFor = null;
    await this.renderQuestion();
  }
  async onOpen() {
    await this.renderQuestion();
  }
  getCard() {
    return this.cardId ? this.plugin.getCard(this.cardId) ?? null : null;
  }
  async renderMarkdown(content, container, sourcePath) {
    await import_obsidian.MarkdownRenderer.render(this.app, content, container, sourcePath, this);
  }
  async renderQuestion() {
    this.waitingFor = null;
    const card = this.getCard();
    const root = this.contentEl;
    root.empty();
    root.addClass("tir-review-root");
    if (!card) {
      const missing = root.createDiv({ cls: "tir-review-message" });
      missing.createEl("h2", { text: "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
      missing.createEl("p", { text: "\u0412\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \u0441\u0442\u0440\u043E\u043A\u0430 \u0431\u044B\u043B\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0430 \u0438\u043B\u0438 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0430." });
      return;
    }
    const wrapper = root.createDiv({ cls: "tir-review" });
    const top = wrapper.createDiv({ cls: "tir-review-top" });
    const topInfo = top.createDiv({ cls: "tir-review-top-info" });
    topInfo.createSpan({ text: `\u042D\u0442\u0430\u043F ${card.stage + 1} \u0438\u0437 ${REVIEW_INTERVALS.length}` });
    topInfo.createSpan({
      text: card.stage === REVIEW_INTERVALS.length - 1 ? "\u0446\u0438\u043A\u043B: \u043A\u0430\u0436\u0434\u044B\u0435 9 \u0434\u043D\u0435\u0439" : `\u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B: ${stageIntervalLabel(card.stage)}`
    });
    const urgent = top.createEl("button", {
      cls: "tir-review-urgent-toggle",
      text: "",
      attr: { type: "button" }
    });
    urgent.addEventListener("click", () => {
      void this.plugin.toggleUrgentSource(card.sourcePath);
    });
    this.updateUrgentButton(urgent, card);
    const flashcard = wrapper.createDiv({ cls: "tir-flashcard" });
    const term = flashcard.createDiv({ cls: "tir-flashcard-term markdown-rendered" });
    await this.renderMarkdown(formatTermForDisplay(card.term), term, card.sourcePath);
    const draft = flashcard.createEl("textarea", {
      cls: "tir-answer-draft",
      attr: {
        rows: "6",
        placeholder: "\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A \u043E\u0442\u0432\u0435\u0442\u0430\u2026",
        "aria-label": "\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A \u043E\u0442\u0432\u0435\u0442\u0430",
        spellcheck: "true"
      }
    });
    draft.addEventListener("keydown", (event) => {
      if (draft.value.length > 0 || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const direction = event.key === "ArrowLeft" ? "previousCardId" : event.key === "ArrowRight" ? "nextCardId" : null;
      if (direction === null) return;
      event.preventDefault();
      event.stopPropagation();
      const target = this.getNavigation()[direction];
      if (target !== null) void this.navigateTo(target);
    });
    window.setTimeout(() => draft.focus(), 0);
    const source = flashcard.createEl("button", {
      cls: "tir-source-link",
      text: card.sourcePath,
      attr: { "aria-label": `\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${card.sourcePath}` }
    });
    source.addEventListener("click", () => {
      void this.plugin.openSource(card.sourcePath);
    });
    const navigation = getReviewNavigation(
      this.plugin.cards,
      card.id,
      this.plugin.urgentSourcePaths,
      this.plugin.pinnedCardIds,
      Date.now()
    );
    const cardNavigation = flashcard.createDiv({ cls: "tir-card-navigation" });
    const previous = cardNavigation.createEl("button", {
      cls: "tir-card-navigation-button",
      text: "\u2190",
      attr: {
        "aria-label": "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0430\u044F \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430",
        title: "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0430\u044F \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430",
        "data-navigation-direction": "previous"
      }
    });
    previous.disabled = navigation.previousCardId === null;
    previous.addEventListener("click", () => {
      const target = this.getNavigation().previousCardId;
      if (target !== null) void this.navigateTo(target);
    });
    const next = cardNavigation.createEl("button", {
      cls: "tir-card-navigation-button",
      text: "\u2192",
      attr: {
        "aria-label": "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430",
        title: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430",
        "data-navigation-direction": "next"
      }
    });
    next.disabled = navigation.nextCardId === null;
    next.addEventListener("click", () => {
      const target = this.getNavigation().nextCardId;
      if (target !== null) void this.navigateTo(target);
    });
    const actions = wrapper.createDiv({ cls: "tir-review-actions" });
    const reveal = actions.createEl("button", { cls: "mod-cta tir-reveal", text: "\u0421\u0432\u0435\u0440\u0438\u0442\u044C \u043E\u0442\u0432\u0435\u0442" });
    reveal.addEventListener("click", () => {
      void this.revealAnswer(card, flashcard, actions);
    });
  }
  async navigateTo(cardId) {
    if (this.transitionPending || cardId === this.cardId || !this.plugin.getCard(cardId)) return;
    this.transitionPending = true;
    this.waitingFor = null;
    this.cardId = cardId;
    try {
      await this.renderQuestion();
    } finally {
      this.transitionPending = false;
    }
  }
  async revealAnswer(card, flashcard, actions) {
    if (flashcard.querySelector(".tir-flashcard-definition")) return;
    const definition = flashcard.createDiv({ cls: "tir-flashcard-definition markdown-rendered" });
    await this.renderMarkdown(formatCardTextForDisplay(card.definition), definition, card.sourcePath);
    actions.empty();
    const incorrect = actions.createEl("button", { cls: "tir-answer tir-answer-wrong", text: "\u041D\u0435\u0432\u0435\u0440\u043D\u043E" });
    const correct = actions.createEl("button", { cls: "tir-answer tir-answer-correct", text: "\u0412\u0435\u0440\u043D\u043E" });
    incorrect.addEventListener("click", () => {
      void this.submit(card.id, false);
    });
    correct.addEventListener("click", () => {
      void this.submit(card.id, true);
    });
  }
  async submit(cardId, correct) {
    const updated = await this.plugin.reviewCard(cardId, correct);
    if (!updated) {
      await this.renderQuestion();
      return;
    }
    const action = chooseReviewCompletionAction(
      this.plugin.cards,
      cardId,
      !correct,
      this.plugin.urgentSourcePaths,
      this.plugin.pinnedCardIds,
      Date.now()
    );
    if (action.type === "open") {
      this.cardId = action.cardId;
      await this.renderQuestion();
      return;
    }
    if (action.type === "close") {
      this.waitingFor = null;
      this.leaf.detach();
      return;
    }
    this.cardId = action.cardId;
    this.waitingFor = { cardId: action.cardId, dueAt: action.dueAt };
    this.renderWaiting(updated, correct);
  }
  renderWaiting(updated, correct) {
    const root = this.contentEl;
    root.empty();
    root.addClass("tir-review-root");
    const message = root.createDiv({
      cls: correct ? "tir-review-message tir-result-correct" : "tir-review-message tir-result-wrong"
    });
    message.createEl("h2", { text: correct ? "\u041E\u0442\u0432\u0435\u0442 \u043E\u0442\u043C\u0435\u0447\u0435\u043D \u043A\u0430\u043A \u0432\u0435\u0440\u043D\u044B\u0439" : "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0441\u0431\u0440\u043E\u0448\u0435\u043D" });
    message.createEl("p", {
      text: correct ? `\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0435 \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 ${stageIntervalLabel(updated.stage)}.` : "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0435 \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 5 \u0441\u0435\u043A\u0443\u043D\u0434."
    });
    message.createEl("p", {
      cls: "tir-wait-countdown",
      text: this.waitingFor ? `\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435: ${formatDuration(this.waitingFor.dueAt - Date.now())}` : "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438"
    });
    message.createEl("p", {
      cls: "tir-next-date",
      text: this.waitingFor ? `\u041D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u043E \u043D\u0430 ${formatDateTime(this.waitingFor.dueAt)}` : ""
    });
  }
  tick(now = Date.now()) {
    const waiting = this.waitingFor;
    if (!waiting || this.transitionPending) return;
    const target = this.plugin.getCard(waiting.cardId);
    if (!target) {
      this.waitingFor = null;
      this.leaf.detach();
      return;
    }
    waiting.dueAt = target.dueAt;
    if (target.dueAt <= now) {
      this.transitionPending = true;
      this.waitingFor = null;
      this.cardId = target.id;
      void this.renderQuestion().finally(() => {
        this.transitionPending = false;
      });
      return;
    }
    const countdown = this.contentEl.querySelector(".tir-wait-countdown");
    if (countdown) countdown.setText(`\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435: ${formatDuration(target.dueAt - now)}`);
    const nextDate = this.contentEl.querySelector(".tir-next-date");
    if (nextDate) nextDate.setText(`\u041D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u043E \u043D\u0430 ${formatDateTime(target.dueAt)}`);
  }
  refreshPriorityControls() {
    const card = this.getCard();
    if (!card) return;
    const urgent = this.contentEl.querySelector(".tir-review-urgent-toggle");
    if (urgent) this.updateUrgentButton(urgent, card);
    const navigation = this.getNavigation();
    const previous = this.contentEl.querySelector(
      '[data-navigation-direction="previous"]'
    );
    const next = this.contentEl.querySelector(
      '[data-navigation-direction="next"]'
    );
    if (previous) previous.disabled = navigation.previousCardId === null;
    if (next) next.disabled = navigation.nextCardId === null;
  }
  getNavigation() {
    return this.cardId ? getReviewNavigation(
      this.plugin.cards,
      this.cardId,
      this.plugin.urgentSourcePaths,
      this.plugin.pinnedCardIds,
      Date.now()
    ) : { previousCardId: null, nextCardId: null };
  }
  updateUrgentButton(button, card) {
    const isUrgent = this.plugin.isUrgentSource(card.sourcePath);
    if (isUrgent) button.setText("\u0423\u0431\u0440\u0430\u0442\u044C");
    else renderMultiPinIcon(button);
    button.classList.toggle("is-active", isUrgent);
    button.classList.toggle("tir-multi-pin-toggle", !isUrgent);
    button.setAttribute("aria-pressed", String(isUrgent));
    button.setAttribute(
      "aria-label",
      isUrgent ? `\u0423\u0431\u0440\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${card.sourcePath} \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445` : `\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${card.sourcePath} \u0432 \u0441\u0440\u043E\u0447\u043D\u044B\u0435`
    );
    button.title = isUrgent ? "\u0423\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445" : "\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u0432\u0441\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0441\u0440\u043E\u0447\u043D\u043E\u0439";
  }
};
var TermIntervalReviewSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  plugin;
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u0420\u0435\u0436\u0438\u043C \u0441\u043D\u0430" });
    this.addTimeSetting(
      "\u0412\u0440\u0435\u043C\u044F \u043E\u0442\u0445\u043E\u0434\u0430 \u043A\u043E \u0441\u043D\u0443",
      "\u041F\u043E\u0441\u043B\u0435 \u044D\u0442\u043E\u0433\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438, \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044B\u0435 \u0434\u043E \u043F\u043E\u0434\u044A\u0451\u043C\u0430, \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0437\u0430\u0440\u0430\u043D\u0435\u0435.",
      "bedtime"
    );
    this.addTimeSetting(
      "\u0412\u0440\u0435\u043C\u044F \u043F\u043E\u0434\u044A\u0451\u043C\u0430",
      "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0438, \u0441\u0440\u043E\u043A \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u043D\u0430\u0441\u0442\u0443\u043F\u0438\u0442 \u0434\u043E \u044D\u0442\u043E\u0433\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438, \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u043F\u0435\u0440\u0435\u0434 \u0441\u043D\u043E\u043C.",
      "wakeTime"
    );
  }
  addTimeSetting(name, description, key) {
    new import_obsidian.Setting(this.containerEl).setName(name).setDesc(description).addText((component) => {
      component.inputEl.type = "time";
      component.inputEl.step = "60";
      component.setValue(this.plugin.settings[key]);
      component.onChange(async (value) => {
        const normalized = normalizeClockTime(value, null);
        if (normalized === null || normalized === this.plugin.settings[key]) return;
        await this.plugin.updateSleepSetting(key, normalized);
      });
      component.inputEl.addEventListener("blur", () => {
        const normalized = normalizeClockTime(component.getValue(), null);
        if (normalized === null) component.setValue(this.plugin.settings[key]);
      });
    });
  }
};
var TermIntervalReviewPlugin = class extends import_obsidian.Plugin {
  cards = [];
  urgentSourcePaths = /* @__PURE__ */ new Set();
  pinnedCardIds = /* @__PURE__ */ new Set();
  fileStates = {};
  settings = { ...DEFAULT_SETTINGS };
  modifyTimers = /* @__PURE__ */ new Map();
  saveTimer = null;
  savePromise = Promise.resolve();
  scanChain = Promise.resolve();
  startupScanTimer = null;
  watchersRegistered = false;
  disposed = false;
  async onload() {
    await this.loadPluginData();
    this.addSettingTab(new TermIntervalReviewSettingTab(this.app, this));
    this.registerView(QUEUE_VIEW_TYPE, (leaf) => new QueueView(leaf, this));
    this.registerView(CARD_VIEW_TYPE, (leaf) => new ReviewView(leaf, this));
    this.addCommand({
      id: "open-term-review-queue",
      name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u044F \u0442\u0435\u0440\u043C\u0438\u043D\u043E\u0432",
      callback: () => {
        void this.activateQueueView();
      }
    });
    this.addCommand({
      id: "rescan-term-lines",
      name: "\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044F **\u0442\u0435\u0440\u043C\u0438\u043D \u2014 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435**",
      callback: () => {
        this.cancelStartupScan();
        void this.runScan(() => this.synchronizeAll(true, true));
      }
    });
    this.registerInterval(
      window.setInterval(() => {
        this.tickViews();
      }, 1e3)
    );
    this.app.workspace.onLayoutReady(() => {
      void this.initializeWorkspace();
    });
    this.register(() => {
      for (const timer of this.modifyTimers.values()) window.clearTimeout(timer);
      this.modifyTimers.clear();
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      this.cancelStartupScan();
    });
  }
  onunload() {
    this.disposed = true;
    this.app.workspace.detachLeavesOfType(QUEUE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CARD_VIEW_TYPE);
  }
  getCard(id) {
    return this.cards.find((card) => card.id === id);
  }
  isUrgentSource(path) {
    return this.urgentSourcePaths.has(path);
  }
  isPinnedCard(id) {
    return this.pinnedCardIds.has(id);
  }
  async toggleUrgentSource(path) {
    if (this.urgentSourcePaths.has(path)) {
      this.urgentSourcePaths.delete(path);
      for (const card of this.cards) {
        if (card.sourcePath === path) this.pinnedCardIds.delete(card.id);
      }
    } else this.urgentSourcePaths.add(path);
    this.clearQueueSearch();
    await this.persistNow();
    this.refreshViews(true);
    this.refreshReviewPriorityControls();
  }
  async togglePinnedCard(id) {
    const card = this.getCard(id);
    if (!card || !this.urgentSourcePaths.has(card.sourcePath)) return;
    if (this.pinnedCardIds.has(id)) this.pinnedCardIds.delete(id);
    else this.pinnedCardIds.add(id);
    await this.persistNow();
    this.refreshViews(true);
    this.refreshReviewPriorityControls();
  }
  async updateSleepSetting(key, value) {
    this.settings = normalizeSettings({ ...this.settings, [key]: value });
    applySettings(this.settings);
    await this.persistNow();
    this.refreshViews(true);
    this.refreshReviewPriorityControls();
  }
  clearQueueSearch() {
    for (const leaf of this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)) {
      if (leaf.view instanceof QueueView) leaf.view.clearSearch();
    }
  }
  async openCard(cardId) {
    let leaf = this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)[0];
    leaf ??= this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: CARD_VIEW_TYPE, active: true, state: { cardId } });
    await this.app.workspace.revealLeaf(leaf);
  }
  async openSource(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian.TFile)) {
      new import_obsidian.Notice("\u0418\u0441\u0445\u043E\u0434\u043D\u0430\u044F \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430");
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
  async reviewCard(cardId, correct) {
    const index = this.cards.findIndex((card2) => card2.id === cardId);
    const card = this.cards[index];
    if (index < 0 || !card) return null;
    const updated = correct ? scheduleCorrect(card, Date.now()) : scheduleIncorrect(card, Date.now());
    this.cards[index] = updated;
    await this.persistNow();
    this.refreshViews(true);
    return updated;
  }
  async initializeWorkspace() {
    try {
      await this.activateQueueView();
      this.registerVaultWatchers();
      this.startupScanTimer = window.setTimeout(() => {
        this.startupScanTimer = null;
        void this.runScan(() => this.synchronizeAll(false, false)).catch((error) => {
          console.error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u043F\u0443\u0441\u043A\u0430", error);
          new import_obsidian.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0434\u043B\u044F \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u044F");
        });
      }, STARTUP_SCAN_DELAY);
    } catch (error) {
      console.error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u0435 \u0442\u0435\u0440\u043C\u0438\u043D\u043E\u0432", error);
      new import_obsidian.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u043B\u0430\u0433\u0438\u043D \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u044F \u0442\u0435\u0440\u043C\u0438\u043D\u043E\u0432");
    }
  }
  async activateQueueView() {
    let leaf = this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(true) ?? void 0;
      if (!leaf) {
        new import_obsidian.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u0430\u0432\u0443\u044E \u043F\u0430\u043D\u0435\u043B\u044C \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0438\u044F");
        return;
      }
      await leaf.setViewState({ type: QUEUE_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }
  registerVaultWatchers() {
    if (this.watchersRegistered) return;
    this.watchersRegistered = true;
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof import_obsidian.TFile && file.extension === "md") this.queueFileScan(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian.TFile && file.extension === "md") this.queueFileScan(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        void this.runScan(() => this.handleDelete(file));
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.runScan(() => this.handleRename(file, oldPath));
      })
    );
  }
  async loadPluginData() {
    const raw = await this.loadData();
    const rawSettings = raw && typeof raw === "object" && raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings) ? raw.settings : null;
    this.settings = normalizeSettings(rawSettings);
    applySettings(this.settings);
    const rawCards = raw && typeof raw === "object" && Array.isArray(raw.cards) ? raw.cards ?? [] : [];
    const now = Date.now();
    this.cards = rawCards.filter(isReviewCard).map((card) => ({
      ...card,
      stage: clampStage(card.stage),
      dueAt: Number.isFinite(card.dueAt) ? card.dueAt : now + REVIEW_INTERVALS[0],
      createdAt: Number.isFinite(card.createdAt) ? card.createdAt : now,
      updatedAt: Number.isFinite(card.updatedAt) ? card.updatedAt : now,
      lastReviewedAt: Number.isFinite(card.lastReviewedAt) ? card.lastReviewedAt : null,
      correctCount: Number.isFinite(card.correctCount) ? card.correctCount : 0,
      incorrectCount: Number.isFinite(card.incorrectCount) ? card.incorrectCount : 0
    }));
    const rawVersion = raw && typeof raw === "object" ? raw.version : null;
    const rawStates = raw && typeof raw === "object" ? raw.fileStates : null;
    if ((rawVersion === 3 || rawVersion === 4 || rawVersion === 5 || rawVersion === 6) && rawStates && typeof rawStates === "object" && !Array.isArray(rawStates)) {
      for (const [path, state] of Object.entries(rawStates)) {
        if (isFileScanState(state)) this.fileStates[path] = state;
      }
    }
    const rawUrgent = raw && typeof raw === "object" ? raw.urgentSourcePaths : null;
    if (Array.isArray(rawUrgent)) {
      this.urgentSourcePaths = new Set(
        rawUrgent.filter((path) => typeof path === "string" && path.length > 0)
      );
    }
    const rawPinned = raw && typeof raw === "object" ? raw.pinnedCardIds : null;
    if (Array.isArray(rawPinned)) {
      const cardIds = new Set(
        this.cards.filter((card) => this.urgentSourcePaths.has(card.sourcePath)).map((card) => card.id)
      );
      this.pinnedCardIds = new Set(
        rawPinned.filter((id) => typeof id === "string" && cardIds.has(id))
      );
    }
  }
  async synchronizeAll(showNotice, force) {
    const files = this.app.vault.getMarkdownFiles();
    const paths = new Set(files.map((file) => file.path));
    let dataChanged = false;
    let cardsChanged = false;
    let scannedFiles = 0;
    for (const file of files) {
      if (this.disposed) return;
      const currentState = createFileScanState(file.stat);
      if (!force && isSameFileState(this.fileStates[file.path], currentState)) continue;
      const result = await this.synchronizeFile(file, false, force);
      dataChanged ||= result.dataChanged;
      cardsChanged ||= result.cardsChanged;
      scannedFiles += 1;
      if (scannedFiles % SCAN_YIELD_EVERY === 0) await this.yieldToObsidian();
    }
    const before = this.cards.length;
    this.cards = this.cards.filter((card) => paths.has(card.sourcePath));
    if (before !== this.cards.length) {
      dataChanged = true;
      cardsChanged = true;
    }
    for (const sourcePath of [...this.urgentSourcePaths]) {
      if (!paths.has(sourcePath)) {
        this.urgentSourcePaths.delete(sourcePath);
        dataChanged = true;
      }
    }
    const cardIds = new Set(this.cards.map((card) => card.id));
    for (const cardId of [...this.pinnedCardIds]) {
      if (!cardIds.has(cardId)) {
        this.pinnedCardIds.delete(cardId);
        dataChanged = true;
      }
    }
    const pruned = pruneFileStates(this.fileStates, paths);
    this.fileStates = pruned.states;
    dataChanged ||= pruned.changed;
    if (dataChanged) await this.persistNow();
    if (cardsChanged) this.refreshViews(true);
    else this.tickViews();
    if (showNotice) {
      new import_obsidian.Notice(`\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u0437\u0430\u043C\u0435\u0442\u043E\u043A: ${scannedFiles}. \u041A\u0430\u0440\u0442\u043E\u0447\u0435\u043A: ${this.cards.length}`);
    }
  }
  queueFileScan(file) {
    const previous = this.modifyTimers.get(file.path);
    if (previous !== void 0) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      this.modifyTimers.delete(file.path);
      void this.runScan(() => this.synchronizeFile(file, true, false));
    }, SAVE_DELAY);
    this.modifyTimers.set(file.path, timer);
  }
  async synchronizeFile(file, persist, force) {
    const currentState = createFileScanState(file.stat);
    if (!force && isSameFileState(this.fileStates[file.path], currentState)) {
      return { dataChanged: false, cardsChanged: false };
    }
    let content;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (error) {
      console.error(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C ${file.path}`, error);
      return { dataChanged: false, cardsChanged: false };
    }
    const entries = parseTermLines(content);
    const existing = this.cards.filter((card) => card.sourcePath === file.path);
    const normalizeStoredTerm = (term) => formatTermForDisplay(term).replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, "").trim();
    const existingByKey = new Map(
      existing.map((card) => [
        `${normalizeStoredTerm(card.term)}\0${card.occurrence}`,
        card
      ])
    );
    const nextForFile = [];
    const now = Date.now();
    let cardsChanged = false;
    for (const entry of entries) {
      const card = existingByKey.get(`${entry.term}\0${entry.occurrence}`);
      if (card) {
        if (card.term !== entry.term || card.definition !== entry.definition) {
          nextForFile.push({
            ...card,
            term: entry.term,
            definition: entry.definition,
            updatedAt: now
          });
          cardsChanged = true;
        } else nextForFile.push(card);
      } else {
        const created = {
          id: createId(),
          term: entry.term,
          definition: entry.definition,
          sourcePath: file.path,
          occurrence: entry.occurrence,
          stage: 0,
          dueAt: now + REVIEW_INTERVALS[0],
          createdAt: now,
          updatedAt: now,
          lastReviewedAt: null,
          correctCount: 0,
          incorrectCount: 0
        };
        nextForFile.push(created);
        cardsChanged = true;
      }
    }
    if (existing.length !== nextForFile.length) cardsChanged = true;
    if (cardsChanged) {
      this.cards = [
        ...this.cards.filter((card) => card.sourcePath !== file.path),
        ...nextForFile
      ];
      const cardIds = new Set(this.cards.map((card) => card.id));
      for (const cardId of [...this.pinnedCardIds]) {
        if (!cardIds.has(cardId)) this.pinnedCardIds.delete(cardId);
      }
    }
    this.fileStates[file.path] = currentState;
    if (persist) {
      this.schedulePersist();
      if (cardsChanged) this.refreshViews(true);
    }
    return { dataChanged: true, cardsChanged };
  }
  async handleDelete(file) {
    const path = file.path;
    const prefix = file instanceof import_obsidian.TFolder ? `${path}/` : null;
    const before = this.cards.length;
    this.cards = this.cards.filter(
      (card) => card.sourcePath !== path && (prefix === null || !card.sourcePath.startsWith(prefix))
    );
    let stateChanged = false;
    for (const statePath of Object.keys(this.fileStates)) {
      if (statePath === path || prefix !== null && statePath.startsWith(prefix)) {
        delete this.fileStates[statePath];
        stateChanged = true;
      }
    }
    let urgentChanged = false;
    for (const sourcePath of [...this.urgentSourcePaths]) {
      if (sourcePath === path || prefix !== null && sourcePath.startsWith(prefix)) {
        this.urgentSourcePaths.delete(sourcePath);
        urgentChanged = true;
      }
    }
    let pinnedChanged = false;
    const cardIds = new Set(this.cards.map((card) => card.id));
    for (const cardId of [...this.pinnedCardIds]) {
      if (!cardIds.has(cardId)) {
        this.pinnedCardIds.delete(cardId);
        pinnedChanged = true;
      }
    }
    if (before !== this.cards.length || stateChanged || urgentChanged || pinnedChanged) {
      await this.persistNow();
      if (before !== this.cards.length || urgentChanged || pinnedChanged) {
        this.refreshViews(true);
        this.refreshReviewPriorityControls();
      }
    }
  }
  async handleRename(file, oldPath) {
    let changed = false;
    const oldPrefix = file instanceof import_obsidian.TFolder ? `${oldPath}/` : null;
    const newPrefix = file instanceof import_obsidian.TFolder ? `${file.path}/` : null;
    for (const card of this.cards) {
      if (card.sourcePath === oldPath) {
        card.sourcePath = file.path;
        changed = true;
      } else if (oldPrefix && newPrefix && card.sourcePath.startsWith(oldPrefix)) {
        card.sourcePath = `${newPrefix}${card.sourcePath.slice(oldPrefix.length)}`;
        changed = true;
      }
    }
    for (const [statePath, state] of Object.entries(this.fileStates)) {
      let nextPath = null;
      if (statePath === oldPath) nextPath = file.path;
      else if (oldPrefix && newPrefix && statePath.startsWith(oldPrefix)) {
        nextPath = `${newPrefix}${statePath.slice(oldPrefix.length)}`;
      }
      if (nextPath !== null) {
        delete this.fileStates[statePath];
        this.fileStates[nextPath] = state;
        changed = true;
      }
    }
    for (const sourcePath of [...this.urgentSourcePaths]) {
      let nextPath = null;
      if (sourcePath === oldPath) nextPath = file.path;
      else if (oldPrefix && newPrefix && sourcePath.startsWith(oldPrefix)) {
        nextPath = `${newPrefix}${sourcePath.slice(oldPrefix.length)}`;
      }
      if (nextPath !== null) {
        this.urgentSourcePaths.delete(sourcePath);
        this.urgentSourcePaths.add(nextPath);
        changed = true;
      }
    }
    const pending = this.modifyTimers.get(oldPath);
    if (pending !== void 0) {
      window.clearTimeout(pending);
      this.modifyTimers.delete(oldPath);
    }
    if (changed) {
      await this.persistNow();
      this.refreshViews(true);
      this.refreshReviewPriorityControls();
    }
    if (file instanceof import_obsidian.TFile && file.extension === "md") this.queueFileScan(file);
  }
  runScan(operation) {
    const run = this.scanChain.then(operation);
    this.scanChain = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  cancelStartupScan() {
    if (this.startupScanTimer === null) return;
    window.clearTimeout(this.startupScanTimer);
    this.startupScanTimer = null;
  }
  async yieldToObsidian() {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  schedulePersist() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistNow();
    }, SAVE_DELAY);
  }
  async persistNow() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.savePromise = this.savePromise.then(async () => {
      const data = {
        version: 6,
        settings: this.settings,
        cards: this.cards,
        fileStates: this.fileStates,
        urgentSourcePaths: [...this.urgentSourcePaths].sort(
          (left, right) => left.localeCompare(right, "ru")
        ),
        pinnedCardIds: [...this.pinnedCardIds].sort(
          (left, right) => left.localeCompare(right, "ru")
        )
      };
      await this.saveData(data);
    });
    await this.savePromise;
  }
  refreshViews(force = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)) {
      if (leaf.view instanceof QueueView) leaf.view.refresh(force);
    }
  }
  refreshReviewPriorityControls() {
    for (const leaf of this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)) {
      if (leaf.view instanceof ReviewView) leaf.view.refreshPriorityControls();
    }
  }
  tickViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)) {
      if (leaf.view instanceof QueueView) leaf.view.tick();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)) {
      if (leaf.view instanceof ReviewView) leaf.view.tick();
    }
  }
};
