"use strict";

const __modules = {
"src/main.js": function(module, exports, __require) {
"use strict";

const { TermIntervalReviewPlugin } = __require("src/plugin.js");

module.exports = TermIntervalReviewPlugin;

},
"src/plugin.js": function(module, exports, __require) {
"use strict";

const { Notice, Plugin } = require("obsidian");
const { hydratePluginData, serializePluginData } = __require("src/application/plugin-data.js");
const { ReviewService } = __require("src/application/review-service.js");
const { ReviewState } = __require("src/application/review-state.js");
const { PersistenceQueue } = __require("src/infrastructure/persistence-queue.js");
const { VaultIndex } = __require("src/infrastructure/vault-index.js");
const {
  CARD_VIEW_TYPE,
  QUEUE_VIEW_TYPE,
  SAVE_DELAY,
  SCAN_YIELD_EVERY,
  STARTUP_SCAN_DELAY
} = __require("src/ui/constants.js");
const { QueueView } = __require("src/ui/queue-view.js");
const { ReviewView } = __require("src/ui/review-view.js");
const { TermIntervalReviewSettingTab } = __require("src/ui/settings-tab.js");
const { ViewCoordinator } = __require("src/ui/view-coordinator.js");

class TermIntervalReviewPlugin extends Plugin {
  state = new ReviewState();
  persistence = null;
  vaultIndex = null;
  views = null;
  reviewService = null;

  get cards() {
    return this.state.cards;
  }

  get urgentSourcePaths() {
    return this.state.urgentSourcePaths;
  }

  get pinnedCardIds() {
    return this.state.pinnedCardIds;
  }

  get growthCardStates() {
    return this.state.growthCardStates;
  }

  get fileStates() {
    return this.state.fileStates;
  }

  get settings() {
    return this.state.settings;
  }

  get activeSourcePath() {
    return this.state.activeSourcePath;
  }

  async onload() {
    await this.loadPluginData();
    this.views = new ViewCoordinator(this.app, this.state);
    this.persistence = new PersistenceQueue({
      delay: SAVE_DELAY,
      save: (data) => this.saveData(data),
      snapshot: () => serializePluginData(this.state)
    });
    this.reviewService = new ReviewService({
      state: this.state,
      persist: () => this.persistNow(),
      resetQueue: () => this.clearQueueSearch(),
      refreshQueue: (force) => this.refreshViews(force),
      refreshPriorityControls: () => this.refreshReviewPriorityControls(),
      refreshCard: (cardId) => this.refreshReviewCard(cardId)
    });
    this.vaultIndex = new VaultIndex({
      app: this.app,
      state: this.state,
      delay: SAVE_DELAY,
      scanYieldEvery: SCAN_YIELD_EVERY,
      startupDelay: STARTUP_SCAN_DELAY,
      persistNow: () => this.persistNow(),
      schedulePersist: () => this.schedulePersist(),
      refreshViews: (force) => this.refreshViews(force),
      refreshPriorityControls: () => this.refreshReviewPriorityControls(),
      registerEvent: (event) => this.registerEvent(event)
    });

    this.rememberActiveSource(this.app.workspace.getActiveFile());
    this.addSettingTab(new TermIntervalReviewSettingTab(this.app, this));
    this.registerView(QUEUE_VIEW_TYPE, (leaf) => new QueueView(leaf, this));
    this.registerView(CARD_VIEW_TYPE, (leaf) => new ReviewView(leaf, this));
    this.addCommand({
      id: "open-term-review-queue",
      name: "Открыть очередь повторения терминов",
      callback: () => void this.activateQueueView()
    });
    this.addCommand({
      id: "rescan-term-lines",
      name: "Повторно проверить определения **термин — определение**",
      callback: () => {
        this.cancelStartupScan();
        void this.runScan(() => this.synchronizeAll(true, true));
      }
    });
    this.registerInterval(window.setInterval(() => this.tickViews(), 1_000));
    this.registerEvent(this.app.workspace.on("file-open", (file) => this.rememberActiveSource(file)));
    this.app.workspace.onLayoutReady(() => void this.initializeWorkspace());
    this.register(() => {
      this.persistence?.dispose();
      this.vaultIndex?.dispose();
    });
  }

  onunload() {
    this.vaultIndex?.dispose();
    this.views?.detach();
  }

  async loadPluginData() {
    this.state = new ReviewState(hydratePluginData(await this.loadData()));
  }

  getCard(id) {
    return this.state.getCard(id);
  }

  rememberActiveSource(file) {
    return this.views?.rememberActiveSource(file) ?? false;
  }

  getActiveDefinitionSource() {
    return this.views?.getActiveDefinitionSource() ?? null;
  }

  isUrgentSource(path) {
    return this.state.isUrgentSource(path);
  }

  isPinnedCard(id) {
    return this.state.isPinnedCard(id);
  }

  isGrowthCard(id) {
    return this.state.isGrowthCard(id);
  }

  getGrowthState(id) {
    return this.state.getGrowthState(id);
  }

  getPriorityPinnedCardIds() {
    return this.state.getPriorityPinnedCardIds();
  }

  getGrowthSignature() {
    return this.state.getGrowthSignature();
  }

  async toggleUrgentSource(path) {
    await this.reviewService?.toggleUrgentSource(path);
  }

  async togglePinnedCard(id) {
    await this.reviewService?.togglePinnedCard(id);
  }

  async toggleGrowthCard(id) {
    await this.reviewService?.toggleGrowthCard(id);
  }

  async updateSleepSetting(key, value) {
    await this.reviewService?.updateSleepSetting(key, value);
  }

  async reviewCard(cardId, correct) {
    return this.reviewService?.review(cardId, correct) ?? null;
  }

  async initializeWorkspace() {
    try {
      await this.activateQueueView();
      this.registerVaultWatchers();
      this.vaultIndex?.scheduleStartupScan();
    } catch (error) {
      console.error("Не удалось запустить повторение терминов", error);
      new Notice("Не удалось запустить плагин повторения терминов");
    }
  }

  activateQueueView() {
    return this.views?.activateQueueView();
  }

  openCard(cardId) {
    return this.views?.openCard(cardId);
  }

  openSource(path) {
    return this.views?.openSource(path);
  }

  clearQueueSearch() {
    this.views?.clearQueueSearch();
  }

  refreshViews(force = false) {
    this.views?.refreshQueue(force);
  }

  refreshReviewPriorityControls() {
    this.views?.refreshReviewPriorityControls();
  }

  refreshReviewCard(cardId) {
    this.views?.refreshReviewCard(cardId);
  }

  tickViews() {
    this.views?.tick();
  }

  registerVaultWatchers() {
    this.vaultIndex?.registerWatchers();
  }

  synchronizeAll(showNotice, force) {
    return this.vaultIndex?.synchronizeAll(showNotice, force);
  }

  synchronizeFile(file, persist = true, force = false) {
    return this.vaultIndex?.synchronizeFile(file, persist, force);
  }

  queueFileScan(file) {
    this.vaultIndex?.queueFileScan(file);
  }

  handleDelete(file) {
    return this.vaultIndex?.handleDelete(file);
  }

  handleRename(file, oldPath) {
    return this.vaultIndex?.handleRename(file, oldPath);
  }

  runScan(operation) {
    return this.vaultIndex?.run(operation) ?? Promise.resolve();
  }

  cancelStartupScan() {
    this.vaultIndex?.cancelStartupScan();
  }

  yieldToObsidian() {
    return this.vaultIndex?.yieldToObsidian() ?? Promise.resolve();
  }

  schedulePersist() {
    this.persistence?.schedule();
  }

  persistNow() {
    return this.persistence?.flush() ?? Promise.resolve();
  }
}

module.exports = { TermIntervalReviewPlugin };

},
"src/application/plugin-data.js": function(module, exports, __require) {
"use strict";

const { getCardKind, isGrowthCardState, isReviewCard } = __require("src/core/card.js");
const { isFileScanState } = __require("src/core/file-state.js");
const { REVIEW_INTERVALS, clampStage } = __require("src/core/schedule.js");
const { normalizeSettings } = __require("src/core/settings.js");

const DATA_VERSION = 12;
const FILE_STATE_VERSIONS = new Set([9, 10, 11, 12]);
const GROWTH_STATE_VERSIONS = new Set([10, 11, 12]);

function hydratePluginData(raw, now = Date.now()) {
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = normalizeSettings(
    source.settings && typeof source.settings === "object" && !Array.isArray(source.settings)
      ? source.settings
      : null
  );
  const cards = (Array.isArray(source.cards) ? source.cards : [])
    .filter(isReviewCard)
    .map((card) => ({
      ...card,
      kind: getCardKind(card),
      listTerms: getCardKind(card) === "list" && Array.isArray(card.listTerms)
        ? card.listTerms.filter((term) => typeof term === "string" && term.length > 0)
        : undefined,
      stage: clampStage(card.stage),
      dueAt: Number.isFinite(card.dueAt) ? card.dueAt : now + REVIEW_INTERVALS[0],
      createdAt: Number.isFinite(card.createdAt) ? card.createdAt : now,
      updatedAt: Number.isFinite(card.updatedAt) ? card.updatedAt : now,
      lastReviewedAt: Number.isFinite(card.lastReviewedAt) ? card.lastReviewedAt : null,
      correctCount: Number.isFinite(card.correctCount) ? card.correctCount : 0,
      incorrectCount: Number.isFinite(card.incorrectCount) ? card.incorrectCount : 0,
      suppressSleepWindowEarlyReview: card.suppressSleepWindowEarlyReview === true
    }));
  const fileStates = {};
  if (FILE_STATE_VERSIONS.has(source.version)
    && source.fileStates && typeof source.fileStates === "object" && !Array.isArray(source.fileStates)) {
    for (const [path, state] of Object.entries(source.fileStates)) {
      if (isFileScanState(state)) fileStates[path] = state;
    }
  }
  const urgentSourcePaths = new Set(
    Array.isArray(source.urgentSourcePaths)
      ? source.urgentSourcePaths.filter((path) => typeof path === "string" && path.length > 0)
      : []
  );
  const cardIds = new Set(cards.map((card) => card.id));
  const pinnedCardIds = new Set(
    Array.isArray(source.pinnedCardIds)
      ? source.pinnedCardIds.filter((id) => typeof id === "string" && cardIds.has(id))
      : []
  );
  const growthCardStates = new Map();
  if (GROWTH_STATE_VERSIONS.has(source.version) && Array.isArray(source.growthCardStates)) {
    for (const entry of source.growthCardStates) {
      if (!entry || typeof entry !== "object" || typeof entry.cardId !== "string"
        || !cardIds.has(entry.cardId) || !isGrowthCardState(entry)) continue;
      growthCardStates.set(entry.cardId, {
        phase: entry.phase,
        step: Math.max(1, Math.trunc(entry.step)),
        incorrectStreak: Math.min(2, Math.max(0, Math.trunc(entry.incorrectStreak ?? 0)))
      });
    }
  }
  return { cards, fileStates, growthCardStates, pinnedCardIds, settings, urgentSourcePaths };
}

function serializePluginData(state) {
  return {
    version: DATA_VERSION,
    settings: state.settings,
    cards: state.cards,
    fileStates: state.fileStates,
    urgentSourcePaths: [...state.urgentSourcePaths].sort((left, right) => left.localeCompare(right, "ru")),
    pinnedCardIds: [...state.pinnedCardIds].sort((left, right) => left.localeCompare(right, "ru")),
    growthCardStates: [...state.growthCardStates.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "ru"))
      .map(([cardId, growth]) => ({
        cardId,
        phase: growth.phase,
        step: growth.step,
        incorrectStreak: growth.incorrectStreak ?? 0
      }))
  };
}

module.exports = { DATA_VERSION, hydratePluginData, serializePluginData };

},
"src/core/card.js": function(module, exports, __require) {
"use strict";

function stripBoldMarkers(value) {
  return String(value ?? "").replaceAll("**", "");
}

function getCardKind(card) {
  return card?.kind === "list" ? "list" : "definition";
}

function normalizeStoredTerm(term) {
  return stripBoldMarkers(term)
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, "")
    .trim();
}

function createCardId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isReviewCard(value) {
  if (!value || typeof value !== "object") return false;
  return typeof value.id === "string"
    && typeof value.term === "string"
    && typeof value.definition === "string"
    && typeof value.sourcePath === "string"
    && typeof value.occurrence === "number"
    && typeof value.stage === "number"
    && typeof value.dueAt === "number";
}

function isGrowthCardState(value) {
  if (!value || typeof value !== "object") return false;
  const validIncorrectStreak = value.incorrectStreak === undefined
    || Number.isFinite(value.incorrectStreak) && value.incorrectStreak >= 0;
  return (value.phase === "building" || value.phase === "retention")
    && Number.isFinite(value.step)
    && value.step >= 1
    && validIncorrectStreak;
}

function hasSameStringItems(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

module.exports = {
  createCardId,
  getCardKind,
  hasSameStringItems,
  isGrowthCardState,
  isReviewCard,
  normalizeStoredTerm,
  stripBoldMarkers
};

},
"src/core/file-state.js": function(module, exports, __require) {
"use strict";

function createFileScanState(stat) {
  return { mtime: stat.mtime, size: stat.size };
}

function isFileScanState(value) {
  return Boolean(value)
    && typeof value === "object"
    && Number.isFinite(value.mtime)
    && Number.isFinite(value.size);
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

module.exports = { createFileScanState, isFileScanState, isSameFileState, pruneFileStates };

},
"src/core/schedule.js": function(module, exports, __require) {
"use strict";

const { getActiveSleepWindowEnd } = __require("src/core/settings.js");

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const REVIEW_INTERVALS = Object.freeze([
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
]);
const REST_WINDOW = 6 * MINUTE;

function clampStage(stage) {
  if (!Number.isFinite(stage)) return 0;
  return Math.max(0, Math.min(Math.trunc(stage), REVIEW_INTERVALS.length - 1));
}

function scheduleCorrect(card, now) {
  const nextStage = Math.min(clampStage(card.stage) + 1, REVIEW_INTERVALS.length - 1);
  return {
    ...card,
    stage: nextStage,
    dueAt: now + (REVIEW_INTERVALS[nextStage] ?? REVIEW_INTERVALS[0]),
    suppressSleepWindowEarlyReview: false,
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
    suppressSleepWindowEarlyReview: false,
    updatedAt: now,
    lastReviewedAt: now,
    incorrectCount: card.incorrectCount + 1
  };
}

function scheduleSleepWindowReview(card, now, correct) {
  const stage = clampStage(card.stage);
  return {
    ...card,
    stage,
    dueAt: now + (REVIEW_INTERVALS[stage] ?? REVIEW_INTERVALS[0]),
    suppressSleepWindowEarlyReview: true,
    updatedAt: now,
    lastReviewedAt: now,
    correctCount: card.correctCount + (correct ? 1 : 0),
    incorrectCount: card.incorrectCount + (correct ? 0 : 1)
  };
}

function isSleepWindowEarlyReview(card, now, settings) {
  if (card.suppressSleepWindowEarlyReview === true) return false;
  const sleepWindowEnd = getActiveSleepWindowEnd(settings, now);
  return sleepWindowEnd !== null && card.dueAt > now && card.dueAt <= sleepWindowEnd;
}

function isAvailable(card, now, settings) {
  return card.dueAt <= now || isSleepWindowEarlyReview(card, now, settings);
}

function compareCardsByDueTime(left, right) {
  return left.dueAt - right.dueAt || left.term.localeCompare(right.term, "ru");
}

function partitionCards(cards, now, settings) {
  const available = [];
  const upcoming = [];
  for (const card of cards) {
    (isAvailable(card, now, settings) ? available : upcoming).push(card);
  }
  available.sort(compareCardsByDueTime);
  upcoming.sort(compareCardsByDueTime);
  return { available, upcoming };
}

function getQueueActivity(cards, now) {
  return cards.some((card) => card.dueAt > now && card.dueAt <= now + REST_WINDOW)
    ? "work"
    : "rest";
}

module.exports = {
  DAY,
  HOUR,
  MINUTE,
  REST_WINDOW,
  REVIEW_INTERVALS,
  SECOND,
  clampStage,
  compareCardsByDueTime,
  getQueueActivity,
  isAvailable,
  isSleepWindowEarlyReview,
  partitionCards,
  scheduleCorrect,
  scheduleIncorrect,
  scheduleSleepWindowReview
};

},
"src/core/settings.js": function(module, exports, __require) {
"use strict";

const DEFAULT_SETTINGS = Object.freeze({
  bedtime: "20:00",
  wakeTime: "06:00"
});

function normalizeClockTime(value, fallback) {
  if (typeof value !== "string") return fallback;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)
    || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
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

function clockTimeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getActiveSleepWindowEnd(settings, now) {
  const normalized = normalizeSettings(settings);
  const bedtime = clockTimeToMinutes(normalized.bedtime);
  const wakeTime = clockTimeToMinutes(normalized.wakeTime);
  if (bedtime === wakeTime) return null;

  const current = new Date(now);
  const currentMinutes = current.getHours() * 60 + current.getMinutes() + current.getSeconds() / 60;
  const crossesMidnight = bedtime > wakeTime;
  const insideSleepWindow = crossesMidnight
    ? currentMinutes >= bedtime || currentMinutes < wakeTime
    : currentMinutes >= bedtime && currentMinutes < wakeTime;
  if (!insideSleepWindow) return null;

  const windowEnd = new Date(current);
  windowEnd.setHours(Math.floor(wakeTime / 60), wakeTime % 60, 0, 0);
  if (windowEnd.getTime() <= now) windowEnd.setDate(windowEnd.getDate() + 1);
  return windowEnd.getTime();
}

module.exports = {
  DEFAULT_SETTINGS,
  clockTimeToMinutes,
  getActiveSleepWindowEnd,
  normalizeClockTime,
  normalizeSettings
};

},
"src/application/review-service.js": function(module, exports, __require) {
"use strict";

const { normalizeSettings } = __require("src/core/settings.js");
const { reviewCard, toggleGrowth } = __require("src/application/review-engine.js");

class ReviewService {
  constructor({
    state,
    persist,
    resetQueue,
    refreshQueue,
    refreshPriorityControls,
    refreshCard,
    now = () => Date.now()
  }) {
    this.state = state;
    this.persist = persist;
    this.resetQueue = resetQueue;
    this.refreshQueue = refreshQueue;
    this.refreshPriorityControls = refreshPriorityControls;
    this.refreshCard = refreshCard;
    this.now = now;
  }

  async toggleUrgentSource(path) {
    if (this.state.urgentSourcePaths.has(path)) this.state.urgentSourcePaths.delete(path);
    else this.state.urgentSourcePaths.add(path);
    this.resetQueue();
    await this.persist();
    this.refreshQueue(true);
    this.refreshPriorityControls();
  }

  async togglePinnedCard(id) {
    if (!this.state.getCard(id)) return;
    if (this.state.pinnedCardIds.has(id)) this.state.pinnedCardIds.delete(id);
    else this.state.pinnedCardIds.add(id);
    await this.persist();
    this.refreshQueue(true);
    this.refreshPriorityControls();
  }

  async toggleGrowthCard(id) {
    const index = this.state.cards.findIndex((card) => card.id === id);
    const card = this.state.cards[index];
    if (index < 0 || !card) return;
    const result = toggleGrowth(card, this.state.getGrowthState(id), this.now());
    if (!result.changed) return;
    this.state.cards[index] = result.card;
    if (result.state === null) this.state.growthCardStates.delete(id);
    else this.state.growthCardStates.set(id, result.state);
    this.resetQueue();
    await this.persist();
    this.refreshQueue(true);
    this.refreshCard(id);
  }

  async updateSleepSetting(key, value) {
    this.state.settings = normalizeSettings({ ...this.state.settings, [key]: value });
    await this.persist();
    this.refreshQueue(true);
    this.refreshPriorityControls();
  }

  async review(cardId, correct) {
    const index = this.state.cards.findIndex((card) => card.id === cardId);
    const card = this.state.cards[index];
    if (index < 0 || !card) return null;
    const result = reviewCard({
      card,
      growthState: this.state.getGrowthState(cardId),
      correct,
      now: this.now(),
      settings: this.state.settings
    });
    this.state.cards[index] = result.card;
    if (result.growthState === null) this.state.growthCardStates.delete(cardId);
    else if (result.growthState) this.state.growthCardStates.set(cardId, result.growthState);
    await this.persist();
    this.refreshQueue(true);
    return {
      card: result.card,
      growthFeedback: result.growthFeedback,
      growthAutoReleased: result.growthAutoReleased
    };
  }
}

module.exports = { ReviewService };

},
"src/application/review-engine.js": function(module, exports, __require) {
"use strict";

const { beginGrowth, GROWTH_AUTO_RELEASE_STAGE, reviewGrowthStep } = __require("src/core/growth.js");
const {
  isSleepWindowEarlyReview,
  scheduleCorrect,
  scheduleIncorrect,
  scheduleSleepWindowReview
} = __require("src/core/schedule.js");

function toggleGrowth(card, currentState, now) {
  if (currentState) return { card, state: null, changed: true };
  const started = beginGrowth(card, now);
  return started
    ? { ...started, changed: true }
    : { card, state: null, changed: false };
}

function reviewCard({ card, growthState, correct, now, settings }) {
  if (growthState?.phase === "building") {
    const result = reviewGrowthStep(card, growthState, correct, now);
    if (result) {
      return {
        card: result.card,
        growthState: result.state,
        growthFeedback: result.feedback,
        growthAutoReleased: false
      };
    }
    growthState = null;
  }

  const sleepWindowReview = isSleepWindowEarlyReview(card, now, settings);
  const updated = sleepWindowReview
    ? scheduleSleepWindowReview(card, now, correct)
    : correct
      ? scheduleCorrect(card, now)
      : scheduleIncorrect(card, now);
  const growthAutoReleased = growthState?.phase === "retention"
    && correct
    && !sleepWindowReview
    && updated.stage >= GROWTH_AUTO_RELEASE_STAGE;
  return {
    card: updated,
    growthState: growthAutoReleased ? null : growthState,
    growthFeedback: null,
    growthAutoReleased
  };
}

module.exports = { reviewCard, toggleGrowth };

},
"src/core/growth.js": function(module, exports, __require) {
"use strict";

const { getCardKind, stripBoldMarkers } = __require("src/core/card.js");

const GROWTH_INTERVAL = 5_000;
const GROWTH_AUTO_RELEASE_STAGE = 6;

function getGrowthUnits(card) {
  if (getCardKind(card) === "list") {
    return (card.listTerms ?? [])
      .map((item) => stripBoldMarkers(item).trim())
      .filter((item) => item.length > 0);
  }
  return stripBoldMarkers(card.definition)
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
}

function getGrowthProgress(card, state) {
  const units = getGrowthUnits(card);
  const total = units.length;
  const step = total === 0 ? 0 : Math.max(1, Math.min(Math.trunc(state?.step ?? 1), total));
  return { units, total, step };
}

function getGrowthFragment(card, step) {
  const units = getGrowthUnits(card);
  const limit = Math.max(0, Math.min(Math.trunc(step), units.length));
  return getCardKind(card) === "list" ? units.slice(0, limit) : units.slice(0, limit).join(" ");
}

function getGrowthRevealProgress(card, state) {
  const progress = getGrowthProgress(card, state);
  const hasAdditionalUnit = progress.step < progress.total;
  return {
    ...progress,
    unitLimit: hasAdditionalUnit ? progress.step + 1 : progress.step,
    emphasizedUnitIndex: hasAdditionalUnit ? progress.step : null
  };
}

function beginGrowth(card, now) {
  const progress = getGrowthProgress(card, { phase: "building", step: 1 });
  if (progress.total === 0) return null;
  return {
    card: {
      ...card,
      stage: 0,
      dueAt: now,
      suppressSleepWindowEarlyReview: false,
      updatedAt: now
    },
    state: { phase: "building", step: 1, incorrectStreak: 0 }
  };
}

function reviewGrowthStep(card, state, correct, now) {
  const progress = getGrowthProgress(card, state);
  if (progress.total === 0) return null;

  const waveComplete = correct && progress.step >= progress.total;
  const incorrectStreak = correct
    ? 0
    : Math.min(2, Math.max(0, Math.trunc(state.incorrectStreak ?? 0)) + 1);
  const resetToFirst = !correct && incorrectStreak >= 2;
  const nextStep = correct
    ? waveComplete ? progress.total : progress.step + 1
    : resetToFirst ? 1 : Math.max(1, progress.step - 1);
  const nextState = waveComplete
    ? { phase: "retention", step: progress.total, incorrectStreak: 0 }
    : { phase: "building", step: nextStep, incorrectStreak };
  const updatedCard = {
    ...card,
    stage: 0,
    dueAt: now + GROWTH_INTERVAL,
    suppressSleepWindowEarlyReview: false,
    updatedAt: now,
    lastReviewedAt: now,
    correctCount: card.correctCount + (correct ? 1 : 0),
    incorrectCount: card.incorrectCount + (correct ? 0 : 1)
  };

  return {
    card: updatedCard,
    state: nextState,
    feedback: {
      step: correct ? waveComplete ? progress.total : nextStep : progress.step,
      nextStep,
      total: progress.total,
      waveComplete,
      resetToFirst,
      incorrectStreak
    }
  };
}

module.exports = {
  GROWTH_AUTO_RELEASE_STAGE,
  GROWTH_INTERVAL,
  beginGrowth,
  getGrowthFragment,
  getGrowthProgress,
  getGrowthRevealProgress,
  getGrowthUnits,
  reviewGrowthStep
};

},
"src/application/review-state.js": function(module, exports, __require) {
"use strict";

const { DEFAULT_SETTINGS } = __require("src/core/settings.js");

class ReviewState {
  constructor(initial = {}) {
    this.cards = initial.cards ?? [];
    this.urgentSourcePaths = initial.urgentSourcePaths ?? new Set();
    this.pinnedCardIds = initial.pinnedCardIds ?? new Set();
    this.growthCardStates = initial.growthCardStates ?? new Map();
    this.fileStates = initial.fileStates ?? {};
    this.settings = initial.settings ?? { ...DEFAULT_SETTINGS };
    this.activeSourcePath = initial.activeSourcePath ?? null;
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

  isGrowthCard(id) {
    return this.growthCardStates.has(id);
  }

  getGrowthState(id) {
    return this.growthCardStates.get(id) ?? null;
  }

  getPriorityPinnedCardIds() {
    return new Set([...this.pinnedCardIds, ...this.growthCardStates.keys()]);
  }

  getGrowthSignature() {
    return [...this.growthCardStates.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "ru"))
      .map(([id, state]) => `${id}:${state.phase}:${state.step}:${state.incorrectStreak ?? 0}`)
      .join(",");
  }

  pruneCardReferences() {
    const cardIds = new Set(this.cards.map((card) => card.id));
    let changed = false;
    for (const cardId of [...this.pinnedCardIds]) {
      if (!cardIds.has(cardId)) {
        this.pinnedCardIds.delete(cardId);
        changed = true;
      }
    }
    for (const cardId of [...this.growthCardStates.keys()]) {
      if (!cardIds.has(cardId)) {
        this.growthCardStates.delete(cardId);
        changed = true;
      }
    }
    return changed;
  }
}

module.exports = { ReviewState };

},
"src/infrastructure/persistence-queue.js": function(module, exports, __require) {
"use strict";

class PersistenceQueue {
  constructor({ delay, save, snapshot }) {
    this.delay = delay;
    this.save = save;
    this.snapshot = snapshot;
    this.timer = null;
    this.chain = Promise.resolve();
  }

  schedule() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delay);
  }

  async flush() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain.then(() => this.save(this.snapshot()));
    await this.chain;
  }

  dispose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = { PersistenceQueue };

},
"src/infrastructure/vault-index.js": function(module, exports, __require) {
"use strict";

const { Notice, TFile, TFolder } = require("obsidian");
const { reconcileSourceCards } = __require("src/application/card-catalog.js");
const { createFileScanState, isSameFileState, pruneFileStates } = __require("src/core/file-state.js");
const { parseReviewEntries } = __require("src/core/parser.js");

class VaultIndex {
  constructor({
    app,
    state,
    delay,
    scanYieldEvery,
    startupDelay,
    persistNow,
    schedulePersist,
    refreshViews,
    refreshPriorityControls,
    registerEvent
  }) {
    this.app = app;
    this.state = state;
    this.delay = delay;
    this.scanYieldEvery = scanYieldEvery;
    this.startupDelay = startupDelay;
    this.persistNow = persistNow;
    this.schedulePersist = schedulePersist;
    this.refreshViews = refreshViews;
    this.refreshPriorityControls = refreshPriorityControls;
    this.registerEvent = registerEvent;
    this.modifyTimers = new Map();
    this.scanChain = Promise.resolve();
    this.startupScanTimer = null;
    this.watchersRegistered = false;
    this.disposed = false;
  }

  registerWatchers() {
    if (this.watchersRegistered) return;
    this.watchersRegistered = true;
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") this.queueFileScan(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "md") this.queueFileScan(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      void this.run(() => this.handleDelete(file));
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void this.run(() => this.handleRename(file, oldPath));
    }));
  }

  scheduleStartupScan() {
    this.cancelStartupScan();
    this.startupScanTimer = window.setTimeout(() => {
      this.startupScanTimer = null;
      void this.run(() => this.synchronizeAll(false, false)).catch((error) => {
        console.error("Не удалось проверить заметки после запуска", error);
        new Notice("Не удалось проверить заметки для повторения");
      });
    }, this.startupDelay);
  }

  cancelStartupScan() {
    if (this.startupScanTimer === null) return;
    window.clearTimeout(this.startupScanTimer);
    this.startupScanTimer = null;
  }

  run(operation) {
    const current = this.scanChain.then(operation);
    this.scanChain = current.then(() => undefined, () => undefined);
    return current;
  }

  queueFileScan(file) {
    const previous = this.modifyTimers.get(file.path);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      this.modifyTimers.delete(file.path);
      void this.run(() => this.synchronizeFile(file, true, false));
    }, this.delay);
    this.modifyTimers.set(file.path, timer);
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
      if (!force && isSameFileState(this.state.fileStates[file.path], currentState)) continue;
      const result = await this.synchronizeFile(file, false, force);
      dataChanged ||= result.dataChanged;
      cardsChanged ||= result.cardsChanged;
      scannedFiles += 1;
      if (scannedFiles % this.scanYieldEvery === 0) await this.yieldToObsidian();
    }

    const before = this.state.cards.length;
    this.state.cards = this.state.cards.filter((card) => paths.has(card.sourcePath));
    if (before !== this.state.cards.length) {
      dataChanged = true;
      cardsChanged = true;
    }
    for (const sourcePath of [...this.state.urgentSourcePaths]) {
      if (!paths.has(sourcePath)) {
        this.state.urgentSourcePaths.delete(sourcePath);
        dataChanged = true;
      }
    }
    const scopedStateChanged = this.state.pruneCardReferences();
    dataChanged ||= scopedStateChanged;
    const pruned = pruneFileStates(this.state.fileStates, paths);
    this.state.fileStates = pruned.states;
    dataChanged ||= pruned.changed;

    if (dataChanged) await this.persistNow();
    if (cardsChanged) this.refreshViews(true);
    else this.refreshViews(false);
    if (showNotice) {
      new Notice(`Проверено заметок: ${scannedFiles}. Карточек: ${this.state.cards.length}`);
    }
  }

  async synchronizeFile(file, persist, force) {
    const currentState = createFileScanState(file.stat);
    if (!force && isSameFileState(this.state.fileStates[file.path], currentState)) {
      return { dataChanged: false, cardsChanged: false };
    }
    let content;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (error) {
      console.error(`Не удалось прочитать ${file.path}`, error);
      return { dataChanged: false, cardsChanged: false };
    }

    const result = reconcileSourceCards(
      this.state.cards,
      parseReviewEntries(content),
      file.path,
      Date.now()
    );
    if (result.cardsChanged) {
      this.state.cards = result.cards;
      this.state.pruneCardReferences();
    }
    this.state.fileStates[file.path] = currentState;
    if (persist) {
      this.schedulePersist();
      if (result.cardsChanged) this.refreshViews(true);
    }
    return { dataChanged: true, cardsChanged: result.cardsChanged };
  }

  async handleDelete(file) {
    const path = file.path;
    const prefix = file instanceof TFolder ? `${path}/` : null;
    const isAffected = (candidate) => candidate === path || prefix !== null && candidate.startsWith(prefix);
    const activeSourceDeleted = this.state.activeSourcePath !== null && isAffected(this.state.activeSourcePath);
    if (activeSourceDeleted) this.state.activeSourcePath = null;

    const before = this.state.cards.length;
    this.state.cards = this.state.cards.filter((card) => !isAffected(card.sourcePath));
    let stateChanged = false;
    for (const statePath of Object.keys(this.state.fileStates)) {
      if (isAffected(statePath)) {
        delete this.state.fileStates[statePath];
        stateChanged = true;
      }
    }
    let urgentChanged = false;
    for (const sourcePath of [...this.state.urgentSourcePaths]) {
      if (isAffected(sourcePath)) {
        this.state.urgentSourcePaths.delete(sourcePath);
        urgentChanged = true;
      }
    }
    const scopedStateChanged = this.state.pruneCardReferences();
    const cardsChanged = before !== this.state.cards.length;
    if (cardsChanged || stateChanged || urgentChanged || scopedStateChanged || activeSourceDeleted) {
      await this.persistNow();
      if (cardsChanged || urgentChanged || scopedStateChanged || activeSourceDeleted) {
        this.refreshViews(true);
        this.refreshPriorityControls();
      }
    }
  }

  async handleRename(file, oldPath) {
    let changed = false;
    const oldPrefix = file instanceof TFolder ? `${oldPath}/` : null;
    const newPrefix = file instanceof TFolder ? `${file.path}/` : null;
    const renamePath = (candidate) => {
      if (candidate === oldPath) return file.path;
      if (oldPrefix && newPrefix && candidate.startsWith(oldPrefix)) {
        return `${newPrefix}${candidate.slice(oldPrefix.length)}`;
      }
      return null;
    };

    const activePath = this.state.activeSourcePath;
    if (activePath !== null) {
      const renamed = renamePath(activePath);
      if (renamed !== null) this.state.activeSourcePath = renamed;
    }
    for (const card of this.state.cards) {
      const renamed = renamePath(card.sourcePath);
      if (renamed !== null) {
        card.sourcePath = renamed;
        changed = true;
      }
    }
    for (const [statePath, state] of Object.entries(this.state.fileStates)) {
      const renamed = renamePath(statePath);
      if (renamed !== null) {
        delete this.state.fileStates[statePath];
        this.state.fileStates[renamed] = state;
        changed = true;
      }
    }
    for (const sourcePath of [...this.state.urgentSourcePaths]) {
      const renamed = renamePath(sourcePath);
      if (renamed !== null) {
        this.state.urgentSourcePaths.delete(sourcePath);
        this.state.urgentSourcePaths.add(renamed);
        changed = true;
      }
    }
    const pending = this.modifyTimers.get(oldPath);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      this.modifyTimers.delete(oldPath);
    }
    if (changed) {
      await this.persistNow();
      this.refreshViews(true);
      this.refreshPriorityControls();
    }
    if (file instanceof TFile && file.extension === "md") this.queueFileScan(file);
  }

  async yieldToObsidian() {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  dispose() {
    this.disposed = true;
    for (const timer of this.modifyTimers.values()) window.clearTimeout(timer);
    this.modifyTimers.clear();
    this.cancelStartupScan();
  }
}

module.exports = { VaultIndex };

},
"src/application/card-catalog.js": function(module, exports, __require) {
"use strict";

const {
  createCardId,
  getCardKind,
  hasSameStringItems,
  normalizeStoredTerm
} = __require("src/core/card.js");
const { REVIEW_INTERVALS } = __require("src/core/schedule.js");

function cardIdentity(kind, term, occurrence) {
  return `${kind}\0${normalizeStoredTerm(term)}\0${occurrence}`;
}

function createCard(entry, sourcePath, now, idFactory) {
  return {
    id: idFactory(),
    kind: entry.kind,
    term: entry.term,
    definition: entry.definition,
    listTerms: entry.kind === "list" ? entry.listTerms : undefined,
    sourcePath,
    occurrence: entry.occurrence,
    stage: 0,
    dueAt: now + REVIEW_INTERVALS[0],
    createdAt: now,
    updatedAt: now,
    lastReviewedAt: null,
    correctCount: 0,
    incorrectCount: 0,
    suppressSleepWindowEarlyReview: false
  };
}

function updateCardFromEntry(card, entry, now) {
  const nextListTerms = entry.kind === "list" ? entry.listTerms : undefined;
  const currentListTerms = Array.isArray(card.listTerms) ? card.listTerms : [];
  const changed = card.term !== entry.term
    || card.definition !== entry.definition
    || getCardKind(card) !== entry.kind
    || entry.kind === "list" && !hasSameStringItems(currentListTerms, nextListTerms);
  if (!changed) return { card, changed: false };
  return {
    card: {
      ...card,
      kind: entry.kind,
      term: entry.term,
      definition: entry.definition,
      listTerms: nextListTerms,
      updatedAt: now
    },
    changed: true
  };
}

function reconcileSourceCards(cards, entries, sourcePath, now, idFactory = createCardId) {
  const existing = cards.filter((card) => card.sourcePath === sourcePath);
  const existingByKey = new Map(existing.map((card) => [
    cardIdentity(getCardKind(card), card.term, card.occurrence),
    card
  ]));
  const nextForSource = [];
  let cardsChanged = false;

  for (const entry of entries) {
    const stored = existingByKey.get(cardIdentity(entry.kind, entry.term, entry.occurrence));
    if (!stored) {
      nextForSource.push(createCard(entry, sourcePath, now, idFactory));
      cardsChanged = true;
      continue;
    }
    const updated = updateCardFromEntry(stored, entry, now);
    nextForSource.push(updated.card);
    cardsChanged ||= updated.changed;
  }
  cardsChanged ||= existing.length !== nextForSource.length;
  return {
    cards: cardsChanged
      ? [...cards.filter((card) => card.sourcePath !== sourcePath), ...nextForSource]
      : cards,
    cardsChanged
  };
}

module.exports = { cardIdentity, createCard, reconcileSourceCards, updateCardFromEntry };

},
"src/core/parser.js": function(module, exports, __require) {
"use strict";

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;
const BOLD_DEFINITION_PATTERN = /\*\*([^*\r\n]+?)\*\*/gu;
const DEFINITION_DELIMITER = "—";
const HEADING_PATTERN = /^\s{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/u;

function parseDefinitionsFromLine(line) {
  const definitions = [];
  for (const match of line.matchAll(BOLD_DEFINITION_PATTERN)) {
    const content = match[1] ?? "";
    const delimiter = content.indexOf(DEFINITION_DELIMITER);
    if (delimiter <= 0) continue;
    const term = content.slice(0, delimiter).trim();
    const definition = content.slice(delimiter + DEFINITION_DELIMITER.length).trim();
    if (term.length === 0 || definition.length === 0) continue;
    definitions.push({ term, definition });
  }
  return definitions;
}

function parseListTermsFromLine(line) {
  const terms = [];
  for (const match of line.matchAll(BOLD_DEFINITION_PATTERN)) {
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

function createMarkdownLineMask(lines) {
  const usable = new Array(lines.length).fill(true);
  let inFrontmatter = lines[0]?.trim() === "---";
  let fenceCharacter = null;
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (inFrontmatter) {
      usable[index] = false;
      if (index > 0 && (trimmed === "---" || trimmed === "...")) inFrontmatter = false;
      continue;
    }
    const fence = line.match(FENCE_PATTERN)?.[1];
    if (fence) {
      usable[index] = false;
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
    if (fenceCharacter !== null) usable[index] = false;
  }
  return usable;
}

function parseTermLines(content) {
  const lines = content.split(/\r?\n/u);
  const usable = createMarkdownLineMask(lines);
  const parsed = [];
  const occurrences = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    if (!usable[index]) continue;
    for (const { term, definition } of parseDefinitionsFromLine(lines[index] ?? "")) {
      const occurrence = occurrences.get(term) ?? 0;
      occurrences.set(term, occurrence + 1);
      parsed.push({ kind: "definition", term, definition, occurrence, line: index + 1 });
    }
  }
  return parsed;
}

function parseDefinitionLists(content) {
  const lines = content.split(/\r?\n/u);
  const usable = createMarkdownLineMask(lines);
  const parsed = [];
  const occurrences = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    if (!usable[index]) continue;
    const headingMatch = (lines[index] ?? "").match(HEADING_PATTERN);
    if (!headingMatch) continue;
    const title = (headingMatch[1] ?? "").replace(/[ \t]+#+[ \t]*$/u, "").trim();
    if (title.length === 0) continue;
    const occurrence = occurrences.get(title) ?? 0;
    occurrences.set(title, occurrence + 1);

    let termIndex = index + 1;
    let lineTerms = parseListTermsFromLine(lines[termIndex] ?? "");
    if (lineTerms.length === 0) continue;
    const terms = [...lineTerms];
    while (termIndex + 1 < lines.length) {
      let candidateIndex = termIndex + 1;
      if ((lines[candidateIndex] ?? "").trim().length === 0) {
        candidateIndex += 1;
        if ((lines[candidateIndex] ?? "").trim().length === 0) break;
      }
      lineTerms = parseListTermsFromLine(lines[candidateIndex] ?? "");
      if (lineTerms.length === 0) break;
      terms.push(...lineTerms);
      termIndex = candidateIndex;
    }
    if (terms.length < 2) continue;
    parsed.push({
      kind: "list",
      term: title,
      definition: terms.join("\n"),
      listTerms: terms,
      occurrence,
      line: index + 1
    });
  }
  return parsed;
}

function parseReviewEntries(content) {
  return [...parseTermLines(content), ...parseDefinitionLists(content)];
}

module.exports = {
  BOLD_DEFINITION_PATTERN,
  DEFINITION_DELIMITER,
  FENCE_PATTERN,
  HEADING_PATTERN,
  createMarkdownLineMask,
  parseDefinitionLists,
  parseDefinitionsFromLine,
  parseListTermsFromLine,
  parseReviewEntries,
  parseTermLines
};

},
"src/ui/constants.js": function(module, exports, __require) {
"use strict";

const QUEUE_VIEW_TYPE = "term-interval-review-queue";
const CARD_VIEW_TYPE = "term-interval-review-card";
const SAVE_DELAY = 650;
const STARTUP_SCAN_DELAY = 6_000;
const SCAN_YIELD_EVERY = 6;

module.exports = {
  CARD_VIEW_TYPE,
  QUEUE_VIEW_TYPE,
  SAVE_DELAY,
  SCAN_YIELD_EVERY,
  STARTUP_SCAN_DELAY
};

},
"src/ui/queue-view.js": function(module, exports, __require) {
"use strict";

const import_obsidian = require("obsidian");
const { formatTermForDisplay, renderMultiPinIcon, renderGrowthIcon, createScrollingTerm } = __require("src/ui/components.js");
const { getQueueActivity } = __require("src/core/schedule.js");
const { formatCardDueTime } = __require("src/core/time.js");
const { partitionCardsByPriority } = __require("src/core/priority.js");
const { scoreCardSearch } = __require("src/core/search.js");
const { QUEUE_VIEW_TYPE } = __require("src/ui/constants.js");

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
    const activeSource = this.plugin.getActiveDefinitionSource();
    const priorityPinnedCardIds = this.plugin.getPriorityPinnedCardIds();
    const partition = partitionCardsByPriority(
      this.plugin.cards,
      this.plugin.urgentSourcePaths,
      priorityPinnedCardIds,
      now,
      this.plugin.settings
    );
    const { pinnedAvailable, urgentAvailable, regularAvailable, upcoming } = partition;
    const availableCount = pinnedAvailable.length + urgentAvailable.length + regularAvailable.length;
    const cardSignature = (card) => `${card.id}@${card.dueAt}`;
    const activeSourceSignature = activeSource ? `${activeSource.path}@${this.plugin.isUrgentSource(activeSource.path) ? "urgent" : "regular"}` : "none";
    const signature = `active-source:${activeSourceSignature}|pinned:${pinnedAvailable.map(cardSignature).join(",")}|urgent:${urgentAvailable.map(cardSignature).join(",")}|regular:${regularAvailable.map(cardSignature).join(",")}|upcoming:${upcoming.map(cardSignature).join(",")}|pinned-ids:${[...priorityPinnedCardIds].sort().join(",")}|growth:${this.plugin.getGrowthSignature()}`;
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
      cls: "tir-activity-icon",
      attr: {
        "data-activity-kind": "mode",
        role: "img"
      }
    });
    this.updateActivityStates(now);
    const search = root.createEl("input", {
      cls: "tir-search",
      type: "search",
      value: this.searchQuery,
      placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0442\u0435\u0440\u043C\u0438\u043D\u0443, \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044E \u0438\u043B\u0438 \u0437\u0430\u043C\u0435\u0442\u043A\u0435\u2026",
      attr: { "aria-label": "\u041F\u043E\u0438\u0441\u043A \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A \u043F\u043E \u0442\u0435\u0440\u043C\u0438\u043D\u0443, \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044E \u0438\u043B\u0438 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0438" }
    });
    search.addEventListener("input", () => {
      this.searchQuery = search.value;
      this.applySearchFilter();
    });
    if (activeSource) this.createActiveSourcePrompt(root, activeSource);
    if (pinnedAvailable.length > 0) {
      this.createSection(
        root,
        "\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043E",
        "pinned",
        pinnedAvailable,
        true,
        now,
        "\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u044B\u0445 \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A \u043D\u0435\u0442",
        "tir-pinned-section"
      );
    }
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
  createActiveSourcePrompt(root, source) {
    const isUrgent = this.plugin.isUrgentSource(source.path);
    const entry = root.createDiv({ cls: "tir-card-entry tir-active-source-prompt" });
    const content = entry.createEl("button", {
      cls: "tir-term-button tir-active-source-button",
      attr: {
        type: "button",
        "aria-label": `\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0435\u0440\u0432\u0443\u044E \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 ${source.title}`,
        title: `\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0435\u0440\u0432\u0443\u044E \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 ${source.title}`
      }
    });
    createScrollingTerm(content, `${source.title} \u2013 ?`);
    content.addEventListener("click", () => {
      void this.plugin.openCard(source.cardId);
    });
    const actions = entry.createDiv({ cls: "tir-entry-actions" });
    const toggle = actions.createEl("button", {
      cls: isUrgent ? "tir-urgent-toggle tir-multi-pin-toggle tir-active-source-toggle is-active" : "tir-urgent-toggle tir-multi-pin-toggle tir-active-source-toggle",
      attr: {
        type: "button",
        "aria-label": isUrgent ? `\u0423\u0431\u0440\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${source.title} \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445` : `\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${source.title} \u0432 \u0441\u0440\u043E\u0447\u043D\u044B\u0435`,
        "aria-pressed": String(isUrgent),
        title: isUrgent ? "\u0423\u0431\u0440\u0430\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445" : "\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u0432\u0441\u044E \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0441\u0440\u043E\u0447\u043D\u043E\u0439"
      }
    });
    renderMultiPinIcon(toggle, isUrgent);
    toggle.addEventListener("click", () => {
      void this.plugin.toggleUrgentSource(source.path);
    });
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
    const mode = getQueueActivity(this.plugin.cards, now);
    const indicator = this.contentEl.querySelector('[data-activity-kind="mode"]');
    if (!indicator) return;
    const isRest = mode === "rest";
    const label = isRest ? "\u041C\u043E\u0436\u043D\u043E \u043E\u0442\u0434\u044B\u0445\u0430\u0442\u044C" : "\u041C\u043E\u0436\u043D\u043E \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C";
    (0, import_obsidian.setIcon)(indicator, isRest ? "coffee" : "briefcase");
    indicator.setAttribute("aria-label", label);
    indicator.setAttribute("title", label);
    indicator.classList.toggle("tir-activity-rest", isRest);
    indicator.classList.toggle("tir-activity-work", !isRest);
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
    createScrollingTerm(content, formatTermForDisplay(card.term));
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
    const isPinned = this.plugin.isPinnedCard(card.id);
    const isGrowing = this.plugin.isGrowthCard(card.id);
    const actions = entry.createDiv({ cls: "tir-entry-actions" });
    if (isUrgent) {
      const remove = actions.createEl("button", {
        cls: "tir-urgent-toggle tir-multi-pin-toggle tir-urgent-remove is-active",
        attr: {
          type: "button",
          "aria-label": `\u0423\u0431\u0440\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${card.sourcePath} \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445`,
          title: "\u0423\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445"
        }
      });
      renderMultiPinIcon(remove, true);
      remove.addEventListener("click", () => {
        void this.plugin.toggleUrgentSource(card.sourcePath);
      });
    } else {
      const priority = actions.createEl("button", {
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
    const pin = actions.createEl("button", {
      cls: isPinned ? "tir-pin-toggle is-active" : "tir-pin-toggle",
      attr: {
        type: "button",
        "aria-label": isPinned ? `\u041E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 ${formatTermForDisplay(card.term)}` : `\u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 ${formatTermForDisplay(card.term)}`,
        "aria-pressed": String(isPinned),
        title: isPinned ? "\u041E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443" : "\u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443"
      }
    });
    (0, import_obsidian.setIcon)(pin, isPinned ? "pin-off" : "pin");
    pin.addEventListener("click", () => {
      void this.plugin.togglePinnedCard(card.id);
    });
    const growth = actions.createEl("button", {
      cls: isGrowing ? "tir-pin-toggle tir-growth-toggle is-active" : "tir-pin-toggle tir-growth-toggle",
      attr: {
        type: "button",
        "aria-label": isGrowing ? `Снять выращивание определения ${formatTermForDisplay(card.term)}` : `Начать выращивание определения ${formatTermForDisplay(card.term)}`,
        "aria-pressed": String(isGrowing),
        title: isGrowing ? "Снять режим выращивания определения" : "Вырастить определение по одному слову"
      }
    });
    renderGrowthIcon(growth);
    growth.addEventListener("click", () => {
      void this.plugin.toggleGrowthCard(card.id);
    });
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
      const count = (visibleCounts.get("pinned") ?? 0) + (visibleCounts.get("urgent") ?? 0) + (visibleCounts.get("regular") ?? 0);
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

module.exports = { QueueView };

},
"src/ui/components.js": function(module, exports, __require) {
"use strict";

const import_obsidian = require("obsidian");
const { stripBoldMarkers } = __require("src/core/card.js");

function formatCardTextForDisplay(text) {
  return stripBoldMarkers(text);
}
var formatTermForDisplay = formatCardTextForDisplay;
function renderMultiPinIcon(button, crossedOut = false) {
  button.empty();
  const group = button.createSpan({ cls: "tir-multi-pin-icon" });
  group.setAttribute("aria-hidden", "true");
  for (let index = 1; index <= 3; index += 1) {
    const pin = group.createSpan({ cls: `tir-multi-pin-part tir-multi-pin-part-${index}` });
    (0, import_obsidian.setIcon)(pin, crossedOut ? "pin-off" : "pin");
  }
}
function renderGrowthIcon(button) {
  button.empty();
  const namespace = "http://www.w3.org/2000/svg";
  const svg = button.ownerDocument.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("tir-growth-icon");
  const liquid = button.ownerDocument.createElementNS(namespace, "path");
  liquid.setAttribute("d", "M3 18c2.2-2.2 4.2 2.2 6.4 0s4.2 2.2 6.4 0 4.2 2.2 5.2.7");
  liquid.classList.add("tir-growth-liquid");
  const bubble = button.ownerDocument.createElementNS(namespace, "circle");
  bubble.setAttribute("cx", "12");
  bubble.setAttribute("cy", "8");
  bubble.setAttribute("r", "4");
  bubble.classList.add("tir-growth-main-bubble");
  const smallBubble = button.ownerDocument.createElementNS(namespace, "circle");
  smallBubble.setAttribute("cx", "7.5");
  smallBubble.setAttribute("cy", "14");
  smallBubble.setAttribute("r", "1.25");
  smallBubble.classList.add("tir-growth-small-bubble");
  const seed = button.ownerDocument.createElementNS(namespace, "circle");
  seed.setAttribute("cx", "16.5");
  seed.setAttribute("cy", "14.5");
  seed.setAttribute("r", "1");
  seed.classList.add("tir-growth-seed");
  svg.append(liquid, bubble, smallBubble, seed);
  button.append(svg);
}
function createScrollingTerm(container, term) {
  const viewport = container.createSpan({ cls: "tir-term" });
  const text = viewport.createSpan({ cls: "tir-term-text", text: term });
  const stopScrolling = () => {
    viewport.classList.remove("is-scrolling");
  };
  const startScrolling = () => {
    stopScrolling();
    const overflow = Math.ceil(text.scrollWidth - viewport.clientWidth);
    if (overflow <= 1) return;
    viewport.style.setProperty("--tir-term-offset", `-${overflow}px`);
    viewport.style.setProperty(
      "--tir-term-scroll-duration",
      `${Math.max(1.6, overflow / 48).toFixed(2)}s`
    );
    void viewport.offsetWidth;
    viewport.classList.add("is-scrolling");
  };
  container.addEventListener("mouseenter", startScrolling);
  container.addEventListener("mouseleave", stopScrolling);
  container.addEventListener("focusin", startScrolling);
  container.addEventListener("focusout", stopScrolling);
  return viewport;
}

module.exports = { formatCardTextForDisplay, formatTermForDisplay, renderMultiPinIcon, renderGrowthIcon, createScrollingTerm };

},
"src/core/time.js": function(module, exports, __require) {
"use strict";

const { DAY, HOUR, MINUTE, REVIEW_INTERVALS, SECOND, clampStage } = __require("src/core/schedule.js");

function formatDuration(milliseconds) {
  const value = Math.max(0, Math.ceil(milliseconds / SECOND) * SECOND);
  if (value < MINUTE) return `${Math.ceil(value / SECOND)} с`;
  if (value < HOUR) {
    const minutes = Math.floor(value / MINUTE);
    const seconds = Math.ceil(value % MINUTE / SECOND);
    return seconds > 0 ? `${minutes} мин ${seconds} с` : `${minutes} мин`;
  }
  if (value < DAY) {
    const hours = Math.floor(value / HOUR);
    const minutes = Math.ceil(value % HOUR / MINUTE);
    return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  }
  const days = Math.floor(value / DAY);
  const hours = Math.ceil(value % DAY / HOUR);
  return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
}

function stageIntervalLabel(stage) {
  return formatDuration(REVIEW_INTERVALS[clampStage(stage)] ?? REVIEW_INTERVALS[0]);
}

function formatCardDueTime(dueAt, available, now) {
  if (!available) return `через ${formatDuration(dueAt - now)}`;
  return dueAt <= now
    ? `просрочено на ${formatDuration(now - dueAt)}`
    : `доступно до подъёма · через ${formatDuration(dueAt - now)}`;
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

module.exports = { formatCardDueTime, formatDateTime, formatDuration, stageIntervalLabel };

},
"src/core/priority.js": function(module, exports, __require) {
"use strict";

const { compareCardsByDueTime, partitionCards } = __require("src/core/schedule.js");

function partitionCardsByPriority(cards, urgentSourcePaths, pinnedCardIds, now, settings) {
  const { available, upcoming } = partitionCards([...cards], now, settings);
  const pinnedAvailable = [];
  const urgentAvailable = [];
  const regularAvailable = [];
  for (const card of available) {
    if (pinnedCardIds.has(card.id)) pinnedAvailable.push(card);
    else if (urgentSourcePaths.has(card.sourcePath)) urgentAvailable.push(card);
    else regularAvailable.push(card);
  }
  pinnedAvailable.sort(compareCardsByDueTime);
  urgentAvailable.sort(compareCardsByDueTime);
  regularAvailable.sort(compareCardsByDueTime);
  return { pinnedAvailable, urgentAvailable, regularAvailable, upcoming };
}

function getAutomaticReviewQueue(cards, urgentSourcePaths, pinnedCardIds, now, settings) {
  const partition = partitionCardsByPriority(cards, urgentSourcePaths, pinnedCardIds, now, settings);
  if (pinnedCardIds.size > 0) return partition.pinnedAvailable;
  return urgentSourcePaths.size > 0 ? partition.urgentAvailable : partition.regularAvailable;
}

module.exports = { getAutomaticReviewQueue, partitionCardsByPriority };

},
"src/core/search.js": function(module, exports, __require) {
"use strict";

const { stripBoldMarkers } = __require("src/core/card.js");

function getNoteTitle(sourcePath) {
  const filename = sourcePath.split("/").at(-1) ?? sourcePath;
  return filename.replace(/\.md$/iu, "");
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/gu, " ")
    .trim();
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
  if (value === query) return 10_000;
  if (value.startsWith(query)) return 9_000 - Math.min(value.length - query.length, 500);
  const words = getSearchWords(value);
  if (words.includes(query)) return 8_500;
  const wordPrefix = words
    .filter((word) => word.startsWith(query))
    .sort((left, right) => left.length - right.length)[0];
  if (wordPrefix) return 8_000 - Math.min(wordPrefix.length - query.length, 500);
  const position = value.indexOf(query);
  if (position >= 0) return 7_000 - Math.min(position, 500);
  if (query.length < 3) return null;
  const allowedEdits = query.length <= 4 ? 1 : Math.max(1, Math.floor(query.length * 0.28));
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of [value, ...words]) {
    if (Math.abs(candidate.length - query.length) > allowedEdits) continue;
    closestDistance = Math.min(closestDistance, getEditDistance(candidate, query));
  }
  return closestDistance > allowedEdits ? null : 5_000 - closestDistance * 250;
}

function scoreCardSearch(card, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return 0;
  const termScore = scoreSearchText(normalizeSearchText(stripBoldMarkers(card.term)), normalizedQuery);
  const definitionScore = scoreSearchText(normalizeSearchText(stripBoldMarkers(card.definition)), normalizedQuery);
  const noteScore = scoreSearchText(normalizeSearchText(getNoteTitle(card.sourcePath)), normalizedQuery);
  if (termScore === null && definitionScore === null && noteScore === null) return null;
  return Math.max(
    termScore === null ? -1 : termScore + 200,
    definitionScore === null ? -1 : definitionScore + 100,
    noteScore ?? -1
  );
}

module.exports = {
  getEditDistance,
  getNoteTitle,
  getSearchWords,
  normalizeSearchText,
  scoreCardSearch,
  scoreSearchText
};

},
"src/ui/review-view.js": function(module, exports, __require) {
"use strict";

const import_obsidian = require("obsidian");
const { formatCardTextForDisplay, formatTermForDisplay, renderMultiPinIcon, renderGrowthIcon } = __require("src/ui/components.js");
const { getCardKind } = __require("src/core/card.js");
const { REVIEW_INTERVALS } = __require("src/core/schedule.js");
const { formatDuration, stageIntervalLabel, formatDateTime } = __require("src/core/time.js");
const { getGrowthUnits, getGrowthProgress, getGrowthFragment, getGrowthRevealProgress } = __require("src/core/growth.js");
const { getReviewNavigation, chooseReviewCompletionAction } = __require("src/core/review-flow.js");
const { CARD_VIEW_TYPE } = __require("src/ui/constants.js");

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
    const growthState = this.plugin.getGrowthState(card.id);
    if (growthState?.phase === "building") {
      const progress = getGrowthProgress(card, growthState);
      topInfo.createSpan({ text: `Рост ${progress.step} из ${progress.total}` });
      topInfo.createSpan({ text: "интервал роста: 5 с" });
    } else {
      topInfo.createSpan({ text: `\u042D\u0442\u0430\u043F ${card.stage + 1} \u0438\u0437 ${REVIEW_INTERVALS.length}` });
      topInfo.createSpan({
        text: card.stage === REVIEW_INTERVALS.length - 1 ? "\u0446\u0438\u043A\u043B: \u043A\u0430\u0436\u0434\u044B\u0435 9 \u0434\u043D\u0435\u0439" : `\u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B: ${stageIntervalLabel(card.stage)}`
      });
    }
    const priorityActions = top.createDiv({ cls: "tir-review-priority-actions" });
    const urgent = priorityActions.createEl("button", {
      cls: "tir-review-urgent-toggle",
      text: "",
      attr: { type: "button" }
    });
    urgent.addEventListener("click", () => {
      void this.plugin.toggleUrgentSource(card.sourcePath);
    });
    this.updateUrgentButton(urgent, card);
    const pin = priorityActions.createEl("button", {
      cls: "tir-review-pin-toggle",
      attr: { type: "button" }
    });
    pin.addEventListener("click", () => {
      void this.plugin.togglePinnedCard(card.id);
    });
    this.updatePinButton(pin, card);
    const growth = priorityActions.createEl("button", {
      cls: "tir-review-pin-toggle tir-review-growth-toggle",
      attr: { type: "button" }
    });
    growth.addEventListener("click", () => {
      void this.plugin.toggleGrowthCard(card.id);
    });
    this.updateGrowthButton(growth, card);
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
      this.plugin.getPriorityPinnedCardIds(),
      Date.now(),
      this.plugin.settings
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
    const growthState = this.plugin.getGrowthState(card.id);
    const revealProgress = growthState?.phase === "building" ? getGrowthRevealProgress(card, growthState) : null;
    await this.renderDefinition(
      card,
      definition,
      revealProgress?.unitLimit ?? null,
      revealProgress?.emphasizedUnitIndex ?? null
    );
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
    const result = await this.plugin.reviewCard(cardId, correct);
    if (!result) {
      await this.renderQuestion();
      return;
    }
    const updated = result.card;
    if (result.growthFeedback) {
      this.cardId = cardId;
      this.waitingFor = { cardId, dueAt: updated.dueAt };
      await this.renderGrowthWaiting(updated, correct, result.growthFeedback);
      return;
    }
    const action = chooseReviewCompletionAction(
      this.plugin.cards,
      cardId,
      !correct,
      this.plugin.urgentSourcePaths,
      this.plugin.getPriorityPinnedCardIds(),
      Date.now(),
      this.plugin.settings
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
  async renderDefinition(card, container, unitLimit = null, emphasizedUnitIndex = null) {
    if (getCardKind(card) === "list") {
      container.addClass("tir-list-answer");
      const list = container.createDiv({ cls: "tir-definition-list", attr: { role: "list" } });
      const items = unitLimit === null ? (card.listTerms ?? []).map((item) => formatTermForDisplay(item)) : getGrowthFragment(card, unitLimit);
      for (const [index, item] of items.entries()) {
        const row = list.createDiv({
          cls: "tir-definition-list-item markdown-rendered",
          attr: { role: "listitem" }
        });
        await this.renderMarkdown(index === emphasizedUnitIndex ? `**${item}**` : item, row, card.sourcePath);
      }
      return;
    }
    let text = unitLimit === null ? formatCardTextForDisplay(card.definition) : getGrowthFragment(card, unitLimit);
    if (unitLimit !== null && emphasizedUnitIndex !== null) {
      text = getGrowthUnits(card).slice(0, unitLimit).map((word, index) => index === emphasizedUnitIndex ? `**${word}**` : word).join(" ");
    }
    await this.renderMarkdown(text, container, card.sourcePath);
  }
  async renderGrowthWaiting(updated, correct, feedback) {
    const root = this.contentEl;
    root.empty();
    root.addClass("tir-review-root");
    const message = root.createDiv({
      cls: correct ? "tir-review-message tir-result-correct tir-growth-result" : "tir-review-message tir-result-wrong tir-growth-result"
    });
    const title = feedback.waveComplete ? "Волна изучения завершена" : correct ? getCardKind(updated) === "list" ? "Добавлен следующий пункт" : "Добавлено новое слово" : "Повтори этот фрагмент";
    message.createEl("h2", { text: title });
    const fragment = message.createDiv({ cls: "tir-growth-feedback markdown-rendered" });
    await this.renderDefinition(updated, fragment, feedback.step);
    message.createEl("p", {
      text: feedback.waveComplete ? "Теперь начнутся обычные этапы. Карточка останется закреплённой до успешного прохождения этапа 6." : feedback.resetToFirst ? "Две ошибки подряд. Прогресс сброшен до этапа 1. Следующая попытка через 5 секунд." : !correct ? `Первая ошибка подряд. Следующая попытка начнётся с этапа ${feedback.nextStep} через 5 секунд.` : `Фрагмент ${feedback.step} из ${feedback.total}. Следующая попытка через 5 секунд.`
    });
    message.createEl("p", {
      cls: "tir-wait-countdown",
      text: `Ожидание: ${formatDuration(updated.dueAt - Date.now())}`
    });
    message.createEl("p", {
      cls: "tir-next-date",
      text: `Назначено на ${formatDateTime(updated.dueAt)}`
    });
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
    const pin = this.contentEl.querySelector(".tir-review-pin-toggle");
    if (pin) this.updatePinButton(pin, card);
    const growth = this.contentEl.querySelector(".tir-review-growth-toggle");
    if (growth) this.updateGrowthButton(growth, card);
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
      this.plugin.getPriorityPinnedCardIds(),
      Date.now(),
      this.plugin.settings
    ) : { previousCardId: null, nextCardId: null };
  }
  updateUrgentButton(button, card) {
    const isUrgent = this.plugin.isUrgentSource(card.sourcePath);
    renderMultiPinIcon(button, isUrgent);
    button.classList.toggle("is-active", isUrgent);
    button.classList.add("tir-multi-pin-toggle");
    button.setAttribute("aria-pressed", String(isUrgent));
    button.setAttribute(
      "aria-label",
      isUrgent ? `\u0423\u0431\u0440\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${card.sourcePath} \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445` : `\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 ${card.sourcePath} \u0432 \u0441\u0440\u043E\u0447\u043D\u044B\u0435`
    );
    button.title = isUrgent ? "\u0423\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0438\u0437 \u0441\u0440\u043E\u0447\u043D\u044B\u0445" : "\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u0432\u0441\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0441\u0440\u043E\u0447\u043D\u043E\u0439";
  }
  updatePinButton(button, card) {
    const isPinned = this.plugin.isPinnedCard(card.id);
    button.disabled = false;
    button.classList.toggle("is-active", isPinned);
    button.setAttribute("aria-pressed", String(isPinned));
    button.setAttribute(
      "aria-label",
      isPinned ? `\u041E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 ${formatTermForDisplay(card.term)}` : `\u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 ${formatTermForDisplay(card.term)}`
    );
    button.title = isPinned ? "\u041E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443" : "\u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443";
    (0, import_obsidian.setIcon)(button, isPinned ? "pin-off" : "pin");
  }
  updateGrowthButton(button, card) {
    const isGrowing = this.plugin.isGrowthCard(card.id);
    button.disabled = false;
    button.classList.toggle("is-active", isGrowing);
    button.setAttribute("aria-pressed", String(isGrowing));
    button.setAttribute(
      "aria-label",
      isGrowing ? `Снять выращивание определения ${formatTermForDisplay(card.term)}` : `Начать выращивание определения ${formatTermForDisplay(card.term)}`
    );
    button.title = isGrowing ? "Снять режим выращивания определения" : "Вырастить определение по одному слову";
    renderGrowthIcon(button);
  }
};

module.exports = { ReviewView };

},
"src/core/review-flow.js": function(module, exports, __require) {
"use strict";

const { getAutomaticReviewQueue } = __require("src/core/priority.js");

const FOLLOW_UP_WAIT_WINDOW = 15_000;

function getReviewNavigation(cards, currentCardId, urgentSourcePaths, pinnedCardIds, now, settings) {
  const available = getAutomaticReviewQueue(cards, urgentSourcePaths, pinnedCardIds, now, settings);
  const currentIndex = available.findIndex((card) => card.id === currentCardId);
  if (currentIndex < 0) return { previousCardId: null, nextCardId: null };
  return {
    previousCardId: available[currentIndex - 1]?.id ?? null,
    nextCardId: available[currentIndex + 1]?.id ?? null
  };
}

function chooseReviewCompletionAction(
  cards,
  completedCardId,
  forceWait,
  urgentSourcePaths,
  pinnedCardIds,
  now,
  settings
) {
  const nextAvailable = getAutomaticReviewQueue(
    cards,
    urgentSourcePaths,
    pinnedCardIds,
    now,
    settings
  ).find((card) => card.id !== completedCardId);
  if (nextAvailable) return { type: "open", cardId: nextAvailable.id };

  const automaticCards = pinnedCardIds.size > 0
    ? cards.filter((card) => pinnedCardIds.has(card.id))
    : urgentSourcePaths.size > 0
      ? cards.filter((card) => urgentSourcePaths.has(card.sourcePath))
      : cards;
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

module.exports = { FOLLOW_UP_WAIT_WINDOW, chooseReviewCompletionAction, getReviewNavigation };

},
"src/ui/settings-tab.js": function(module, exports, __require) {
"use strict";

const import_obsidian = require("obsidian");
const { normalizeClockTime } = __require("src/core/settings.js");

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

module.exports = { TermIntervalReviewSettingTab };

},
"src/ui/view-coordinator.js": function(module, exports, __require) {
"use strict";

const { Notice, TFile } = require("obsidian");
const { compareCardsByDueTime } = __require("src/core/schedule.js");
const { CARD_VIEW_TYPE, QUEUE_VIEW_TYPE } = __require("src/ui/constants.js");
const { QueueView } = __require("src/ui/queue-view.js");
const { ReviewView } = __require("src/ui/review-view.js");

class ViewCoordinator {
  constructor(app, state) {
    this.app = app;
    this.state = state;
  }

  rememberActiveSource(file) {
    if (file === null) return false;
    const nextPath = file instanceof TFile && file.extension === "md" ? file.path : null;
    if (nextPath === this.state.activeSourcePath) return false;
    this.state.activeSourcePath = nextPath;
    this.refreshQueue(true);
    return true;
  }

  getActiveDefinitionSource() {
    const path = this.state.activeSourcePath;
    if (path === null) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return null;
    const firstCard = this.state.cards
      .filter((card) => card.sourcePath === path)
      .sort(compareCardsByDueTime)[0];
    return firstCard ? { path, title: file.basename, cardId: firstCard.id } : null;
  }

  async activateQueueView() {
    let leaf = this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(true) ?? undefined;
      if (!leaf) {
        new Notice("Не удалось открыть правую панель повторения");
        return;
      }
      await leaf.setViewState({ type: QUEUE_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async openCard(cardId) {
    let leaf = this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)[0];
    leaf ??= this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: CARD_VIEW_TYPE, active: true, state: { cardId } });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openSource(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice("Исходная заметка не найдена");
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  clearQueueSearch() {
    for (const leaf of this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)) {
      if (leaf.view instanceof QueueView) leaf.view.clearSearch();
    }
  }

  refreshQueue(force = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)) {
      if (leaf.view instanceof QueueView) leaf.view.refresh(force);
    }
  }

  refreshReviewPriorityControls() {
    for (const leaf of this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)) {
      if (leaf.view instanceof ReviewView) leaf.view.refreshPriorityControls();
    }
  }

  refreshReviewCard(cardId) {
    for (const leaf of this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)) {
      if (leaf.view instanceof ReviewView
        && leaf.view.cardId === cardId
        && leaf.view.waitingFor === null) {
        void leaf.view.renderQuestion();
      }
    }
  }

  tick() {
    for (const leaf of this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE)) {
      if (leaf.view instanceof QueueView) leaf.view.tick();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)) {
      if (leaf.view instanceof ReviewView) leaf.view.tick();
    }
  }

  detach() {
    this.app.workspace.detachLeavesOfType(QUEUE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CARD_VIEW_TYPE);
  }
}

module.exports = { ViewCoordinator };

}
};
const __cache = Object.create(null);
function __require(id) {
  if (__cache[id]) return __cache[id].exports;
  const factory = __modules[id];
  if (!factory) throw new Error(`Не найден встроенный модуль: ${id}`);
  const module = { exports: {} };
  __cache[id] = module;
  factory(module, module.exports, __require);
  return module.exports;
}
module.exports = __require("src/main.js");
