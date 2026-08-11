const Core = require('./main-core.js');

const CONTRAST_ORDER = [
  'Красная',
  'Голубая',
  'Оранжевая',
  'Синяя',
  'Жёлтая',
  'Фиолетовая',
  'Зелёная',
  'Розовая'
];

module.exports = class PersistedStyleSettingsColorCycle extends Core {
  async onload() {
    this._progressKey = `style-settings-color-cycle-progress:${this.app.vault.getName()}`;
    this._resumeApplied = false;
    this._resumeState = this._readSavedProgress();

    await super.onload();
    await this._applyContrastThemeOrder();

    const saveProgress = () => this._saveProgress();
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.hidden) saveProgress();
    });
    this.registerDomEvent(window, 'pagehide', saveProgress);
    this.registerDomEvent(window, 'beforeunload', saveProgress);
  }

  async _applyContrastThemeOrder() {
    if (!this.settings || !Array.isArray(this.settings.presets) || this.settings.presets.length !== 8) return;
    const byName = new Map(this.settings.presets.map(preset => [preset.name, preset]));
    if (!CONTRAST_ORDER.every(name => byName.has(name))) return;
    const reordered = CONTRAST_ORDER.map(name => byName.get(name));
    const changed = reordered.some((preset, index) => preset !== this.settings.presets[index]);
    if (!changed) return;
    const wasRunning = Boolean(this.running);
    if (wasRunning && typeof this.stopCycle === 'function') this.stopCycle();
    this.settings.presets = reordered;
    await this.saveData(this.settings);
    this.segmentIndex = 0;
    this.segmentStart = performance.now();
    this._resumeApplied = true;
    this._resumeState = null;
    if (wasRunning && typeof this.startCycle === 'function') this.startCycle();
  }

  startCycle() {
    super.startCycle();
    if (!this.running || this._resumeApplied) return;
    this._resumeApplied = true;
    const state = this._resumeState;
    if (!state || !Number.isFinite(state.segmentIndex) || !Number.isFinite(state.elapsedMs)) return;
    const holdMs = Math.max(0, Number(this.settings.holdSeconds) || 0) * 1000;
    const transitionMs = Math.max(0.2, Number(this.settings.transitionSeconds) || 8) * 1000;
    const segmentMs = holdMs + transitionMs;
    if (!(segmentMs > 0)) return;
    const index = ((Math.trunc(state.segmentIndex) % 8) + 8) % 8;
    const elapsed = Math.max(0, Math.min(segmentMs - 1, Number(state.elapsedMs) || 0));
    this.segmentIndex = index;
    this.segmentStart = performance.now() - elapsed;
  }

  _readSavedProgress() {
    try {
      const raw = localStorage.getItem(this._progressKey);
      if (!raw) return null;
      const state = JSON.parse(raw);
      if (!state || typeof state !== 'object') return null;
      return state;
    } catch (e) {
      console.warn('[Style Settings Color Cycle] Не удалось прочитать сохранённый прогресс:', e);
      return null;
    }
  }

  _saveProgress() {
    try {
      if (!this.running || !Number.isFinite(this.segmentStart)) return;
      const holdMs = Math.max(0, Number(this.settings.holdSeconds) || 0) * 1000;
      const transitionMs = Math.max(0.2, Number(this.settings.transitionSeconds) || 8) * 1000;
      const segmentMs = holdMs + transitionMs;
      if (!(segmentMs > 0)) return;
      let elapsed = Math.max(0, performance.now() - this.segmentStart);
      let index = Number.isFinite(this.segmentIndex) ? this.segmentIndex : 0;
      if (elapsed >= segmentMs) {
        const steps = Math.floor(elapsed / segmentMs);
        index = (index + steps) % 8;
        elapsed -= steps * segmentMs;
      }
      localStorage.setItem(this._progressKey, JSON.stringify({
        segmentIndex: ((Math.trunc(index) % 8) + 8) % 8,
        elapsedMs: elapsed,
        savedAt: Date.now()
      }));
    } catch (e) {
      console.warn('[Style Settings Color Cycle] Не удалось сохранить прогресс:', e);
    }
  }

  onunload() {
    this._saveProgress();
    super.onunload();
  }
};
