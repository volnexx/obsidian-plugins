const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView } = require('obsidian');

const DEFAULTS = {
  ignoreTrailingWhitespace: true,
  ignoreCase: false,
  fullLineOnly: true,
  excludeCurrentNote: true,
  replaceAllPerNote: true,
  debounceMs: 400,
  minimumLength: 10,
  minimumWords: 2,
  routedLinesEnabled: true,
  routeSeparator: ' – ',
  showNotices: true,
  excludedFolders: '.obsidian, .trash',
  enabled: true
};

module.exports = class LineCloneSyncPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, (await this.loadData()) || {});
    this.snapshots = new WeakMap();
    this.sessions = new Map();
    this.internal = new Set();
    this.lastOperation = null;
    this.addSettingTab(new SettingsTab(this.app, this));
    this.createToggle();
    this.addCommand({ id: 'undo-last-line-sync', name: 'Отменить последнюю синхронизацию строк', callback: () => this.undo() });
    this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => this.onChange(editor, info)));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.captureActive()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.captureActive()));
    this.app.workspace.onLayoutReady(() => this.captureAll());
  }

  onunload() {
    for (const s of this.sessions.values()) if (s.timer) window.clearTimeout(s.timer);
    void this.saveSettings();
  }

  async saveSettings() { await this.saveData(this.settings); }

  createToggle() {
    const item = this.addStatusBarItem();
    item.addClass('line-clone-sync-status');
    this.statusLabel = item.createSpan({ cls: 'line-clone-sync-status__label' });
    this.statusToggle = item.createEl('button', { cls: 'line-clone-sync-status__toggle', attr: { type: 'button', role: 'switch' } });
    this.statusToggle.createSpan({ cls: 'line-clone-sync-status__thumb' });
    this.statusToggle.onclick = async () => this.setEnabled(!this.settings.enabled, true);
    this.updateToggle();
  }

  async setEnabled(value, notice = false) {
    this.settings.enabled = Boolean(value);
    if (!this.settings.enabled) {
      for (const s of this.sessions.values()) if (s.timer) window.clearTimeout(s.timer);
      this.sessions.clear();
    } else this.captureAll();
    await this.saveSettings();
    this.updateToggle();
    if (notice) new Notice(this.settings.enabled ? 'Синхронизация клонов строк включена' : 'Синхронизация клонов строк выключена');
  }

  updateToggle() {
    if (!this.statusToggle) return;
    const on = Boolean(this.settings.enabled);
    this.statusToggle.toggleClass('is-enabled', on);
    this.statusToggle.setAttr('aria-checked', String(on));
    this.statusToggle.setAttr('title', on ? 'Синхронизация включена — нажмите, чтобы выключить' : 'Синхронизация выключена — нажмите, чтобы включить');
    this.statusLabel.setText(on ? 'Клоны строк' : 'Клоны строк: выкл.');
  }

  captureActive() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.editor) this.snapshots.set(view.editor, view.editor.getValue());
  }

  captureAll() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view?.editor) this.snapshots.set(leaf.view.editor, leaf.view.editor.getValue());
    }
  }

  onChange(editor, info) {
    if (!this.settings.enabled) return;
    const now = editor.getValue();
    const before = this.snapshots.get(editor);
    this.snapshots.set(editor, now);
    if (before === undefined || before === now) return;
    const file = info?.file || this.app.workspace.getActiveFile();
    if (!file || this.internal.has(file.path)) return;
    const change = detectSingleLineEdit(before, now);
    if (!change || (!change.deleted && change.oldLine === change.newLine)) return;

    let session = this.sessions.get(file.path);
    if (session && !(session.lineIndex === change.lineIndex && session.current === change.oldLine)) {
      this.stopSession(file.path);
      session = null;
    }

    if (!session) {
      const oldRoute = this.parseRoute(change.oldLine);
      const newRoute = this.parseRoute(change.newLine);
      if (!this.eligible(change.oldLine) && !(newRoute && this.eligible(change.newLine))) return;
      session = {
        sourcePath: file.path,
        sourceName: file.basename,
        lineIndex: change.lineIndex,
        original: change.oldLine,
        current: change.newLine,
        synced: null,
        deleted: change.deleted,
        route: oldRoute || newRoute,
        targets: null,
        timer: 0,
        running: false,
        dirty: true
      };
      this.sessions.set(file.path, session);
    } else {
      session.current = change.newLine;
      session.deleted = change.deleted;
      session.dirty = true;
      const route = this.parseRoute(change.newLine);
      if (route) session.route = route;
    }
    this.schedule(session);
  }

  stopSession(path) {
    const s = this.sessions.get(path);
    if (s?.timer) window.clearTimeout(s.timer);
    this.sessions.delete(path);
  }

  schedule(session) {
    if (session.timer) window.clearTimeout(session.timer);
    session.timer = window.setTimeout(() => {
      session.timer = 0;
      void this.flush(session);
    }, Math.max(50, Number(this.settings.debounceMs) || 400));
  }

  async flush(session) {
    if (!this.settings.enabled || this.sessions.get(session.sourcePath) !== session) return;
    if (session.running) { session.dirty = true; return; }
    session.running = true;
    try {
      while (session.dirty && this.sessions.get(session.sourcePath) === session) {
        session.dirty = false;
        if (session.targets === null) {
          if (!(await this.establish(session))) return;
        } else if (session.synced !== session.current || session.deleted) {
          await this.updateTargets(session);
        }
      }
    } finally {
      session.running = false;
      if (session.dirty && this.sessions.get(session.sourcePath) === session) this.schedule(session);
    }
  }

  eligible(line) {
    const normalized = this.normalize(String(line ?? ''));
    const trimmed = normalized.trim();
    if (!trimmed || /^\s*---\s*$/.test(line) || /^\s*```/.test(line)) return false;
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    return words >= Math.max(1, Number(this.settings.minimumWords) || 1) && normalized.length >= Math.max(1, Number(this.settings.minimumLength) || 1);
  }

  normalize(s) {
    let out = String(s ?? '');
    if (this.settings.ignoreTrailingWhitespace) out = out.replace(/[ \t]+$/g, '');
    if (this.settings.ignoreCase) out = out.toLocaleLowerCase();
    return out;
  }

  excluded(path) {
    return String(this.settings.excludedFolders || '').split(',').map(x => x.trim()).filter(Boolean)
      .some(x => path === x || path.startsWith(x.replace(/\/$/, '') + '/'));
  }

  parseRoute(line) {
    if (!this.settings.routedLinesEnabled) return null;
    const raw = String(line ?? '');
    const marker = raw.match(/^(\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?)/)?.[0] || '';
    const body = raw.slice(marker.length);
    const configured = String(this.settings.routeSeparator || ' – ');
    const separators = [...new Set([configured, ` ${configured.trim()} `, ' – ', ' - ', ' — '].filter(Boolean))];
    let sep = null, at = -1;
    for (const candidate of separators) {
      const i = body.indexOf(candidate);
      if (i > 0 && (at < 0 || i < at)) { sep = candidate; at = i; }
    }
    if (!sep) return null;
    let noteName = body.slice(0, at).trim();
    if (noteName.startsWith('[[') && noteName.endsWith(']]')) noteName = noteName.slice(2, -2).split('|')[0].trim();
    const payload = body.slice(at + sep.length);
    if (!noteName || !payload.trim()) return null;
    const matches = this.app.vault.getMarkdownFiles().filter(f => f.basename === noteName);
    if (matches.length !== 1) return null;
    return { targetPath: matches[0].path, payload, prefix: raw.slice(0, marker.length + at + sep.length) };
  }

  routePayload(session, sourceLine) {
    if (!session.route) return sourceLine;
    if (sourceLine.startsWith(session.route.prefix)) return sourceLine.slice(session.route.prefix.length);
    const route = this.parseRoute(sourceLine);
    return route ? route.payload : sourceLine;
  }

  async safeProcess(file, fn) {
    this.internal.add(file.path);
    try { return await this.app.vault.process(file, fn); }
    finally { window.setTimeout(() => this.internal.delete(file.path), 500); }
  }

  async establish(session) {
    const files = this.app.vault.getMarkdownFiles();
    const backups = [], targets = [];
    let replacements = 0, changedFiles = 0;

    for (const file of files) {
      if (this.sessions.get(session.sourcePath) !== session) return false;
      if ((this.settings.excludeCurrentNote && file.path === session.sourcePath) || this.excluded(file.path)) continue;
      let before = null, result = null;
      await this.safeProcess(file, data => {
        before = data;
        result = this.replaceText(data, session.original, session.current, session.deleted);
        return result.text;
      });
      if (result?.count) {
        backups.push({ path: file.path, content: before });
        targets.push({ path: file.path, indices: result.indices, current: session.current, kind: 'identity' });
        replacements += result.count; changedFiles++;
      }
    }

    if (session.route && !this.excluded(session.route.targetPath) && session.route.targetPath !== session.sourcePath) {
      const file = this.app.vault.getAbstractFileByPath(session.route.targetPath);
      if (file) {
        const wanted = this.routePayload(session, session.current);
        let before = null, result = null;
        await this.safeProcess(file, data => {
          before = data;
          result = session.route.payload ? this.replaceText(data, session.route.payload, wanted, session.deleted) : { text: data, count: 0, indices: [] };
          if (!result.count && !session.deleted && wanted.trim()) {
            const appended = appendLine(data, wanted);
            result = { text: appended.text, count: 1, indices: [appended.index] };
          }
          return result.text;
        });
        if (result?.count && result.text !== before) {
          backups.push({ path: file.path, content: before });
          targets.push({ path: file.path, indices: result.indices, current: wanted, kind: 'payload' });
          replacements += result.count; changedFiles++;
        }
      }
    }

    if (!session.route) {
      const prefixes = [' – ', ' - ', ' — '].map(sep => `${session.sourceName}${sep}`);
      for (const file of files) {
        if (file.path === session.sourcePath || this.excluded(file.path)) continue;
        for (const prefix of prefixes) {
          let before = null, result = null;
          await this.safeProcess(file, data => {
            before = data;
            result = this.replaceText(data, prefix + session.original, prefix + session.current, session.deleted);
            return result.text;
          });
          if (result?.count) {
            backups.push({ path: file.path, content: before });
            targets.push({ path: file.path, indices: result.indices, current: prefix + session.current, kind: 'prefixed', prefix });
            replacements += result.count; changedFiles++;
            break;
          }
        }
      }
    }

    if (!targets.length) { this.sessions.delete(session.sourcePath); return false; }
    this.lastOperation = { backups };
    if (session.deleted) this.sessions.delete(session.sourcePath);
    else { session.targets = targets; session.synced = session.current; }
    if (this.settings.showNotices && replacements) new Notice(`Синхронизировано строк: ${replacements}; заметок: ${changedFiles}`);
    return !session.deleted;
  }

  async updateTargets(session) {
    const backups = [], survivors = [];
    let replacements = 0, changedFiles = 0;
    for (const target of session.targets) {
      const file = this.app.vault.getAbstractFileByPath(target.path);
      if (!file || this.excluded(target.path)) continue;
      const next = target.kind === 'payload' ? this.routePayload(session, session.current)
        : target.kind === 'prefixed' ? target.prefix + session.current : session.current;
      let before = null, result = null;
      await this.safeProcess(file, data => {
        before = data;
        result = this.replaceIndices(data, target.indices, target.current, next, session.deleted);
        return result.text;
      });
      if (result?.count) {
        backups.push({ path: target.path, content: before });
        replacements += result.count; changedFiles++;
        if (!session.deleted) survivors.push({ ...target, indices: result.indices, current: next });
      } else if (!session.deleted) survivors.push(target);
    }
    if (backups.length) this.lastOperation = { backups };
    if (session.deleted) this.sessions.delete(session.sourcePath);
    else { session.targets = survivors; session.synced = session.current; }
    if (this.settings.showNotices && replacements) new Notice(`Синхронизировано строк: ${replacements}; заметок: ${changedFiles}`);
  }

  replaceIndices(text, indices, oldLine, newLine, deleted) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/), changed = [];
    const order = deleted ? [...indices].sort((a,b) => b-a) : indices;
    for (const i of order) {
      if (i < 0 || i >= lines.length || this.normalize(lines[i]) !== this.normalize(oldLine)) continue;
      if (deleted) lines.splice(i, 1); else lines[i] = newLine;
      changed.push(i);
    }
    changed.sort((a,b) => a-b);
    return { text: changed.length ? lines.join(eol) : text, count: changed.length, indices: deleted ? [] : changed };
  }

  replaceText(text, oldLine, newLine, deleted) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/), indices = [];
    if (!this.settings.fullLineOnly && !deleted) {
      const escaped = String(oldLine).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = `${this.settings.ignoreCase ? 'i' : ''}${this.settings.replaceAllPerNote ? 'g' : ''}`;
      let count = 0;
      if (!oldLine) return { text, count: 0, indices };
      for (let i=0;i<lines.length;i++) {
        lines[i] = lines[i].replace(new RegExp(escaped, flags), () => { count++; return newLine; });
        if (count) { indices.push(i); if (!this.settings.replaceAllPerNote) break; }
      }
      return { text: count ? lines.join(eol) : text, count, indices };
    }
    const order = [...lines.keys()];
    if (deleted) order.reverse();
    for (const i of order) {
      if (this.normalize(lines[i]) !== this.normalize(oldLine)) continue;
      if (deleted) lines.splice(i, 1); else lines[i] = newLine;
      indices.push(i);
      if (!this.settings.replaceAllPerNote) break;
    }
    indices.sort((a,b) => a-b);
    return { text: indices.length ? lines.join(eol) : text, count: indices.length, indices };
  }

  async undo() {
    if (!this.lastOperation) return new Notice('Нет синхронизации для отмены');
    let restored = 0;
    for (const backup of this.lastOperation.backups) {
      const file = this.app.vault.getAbstractFileByPath(backup.path);
      if (!file) continue;
      this.internal.add(backup.path);
      try { await this.app.vault.modify(file, backup.content); restored++; }
      finally { window.setTimeout(() => this.internal.delete(backup.path), 500); }
    }
    this.lastOperation = null;
    this.sessions.clear();
    new Notice(`Восстановлено заметок: ${restored}`);
  }
};

function detectSingleLineEdit(before, after) {
  const a = before.split(/\r?\n/), b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let ea = a.length - 1, eb = b.length - 1;
  while (ea >= start && eb >= start && a[ea] === b[eb]) { ea--; eb--; }
  const removed = ea - start + 1, added = eb - start + 1;
  if (removed === 1 && added === 1) return { oldLine: a[start] ?? '', newLine: b[start] ?? '', lineIndex: start, deleted: false };
  if (removed === 1 && added === 0) return { oldLine: a[start] ?? '', newLine: '', lineIndex: start, deleted: true };
  return null;
}

function appendLine(text, line) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const clean = text.replace(/(?:\r?\n)+$/g, '');
  return { text: (clean ? clean + eol : '') + line + eol, index: clean ? clean.split(/\r?\n/).length : 0 };
}

class SettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const c = this.containerEl; c.empty(); c.createEl('h2', { text: 'Синхронизация клонов строк' });
    this.toggle(c, 'Работа плагина', 'Главный переключатель активности.', 'enabled', async v => this.plugin.setEnabled(v));
    this.toggle(c, 'Игнорировать пробелы в конце', 'Конечные пробелы не учитываются.', 'ignoreTrailingWhitespace');
    this.toggle(c, 'Игнорировать регистр', 'Регистр букв не учитывается.', 'ignoreCase');
    this.toggle(c, 'Только полные строки', 'Искать только полное совпадение строки.', 'fullLineOnly');
    this.toggle(c, 'Исключать текущую заметку', 'Не искать копии в редактируемой заметке.', 'excludeCurrentNote');
    this.toggle(c, 'Все совпадения в заметке', 'Заменять все совпадения, а не первое.', 'replaceAllPerNote');
    this.toggle(c, 'Показывать уведомления', 'Показывать только успешные синхронизации.', 'showNotices');
    this.toggle(c, 'Переносить строки по названию заметки', '«Название – текст» создаёт или синхронизирует текст в указанной заметке.', 'routedLinesEnabled');
    this.text(c, 'Разделитель переноса', 'Основной разделитель. Также распознаются -, – и — с пробелами.', 'routeSeparator');
    this.number(c, 'Задержка после ввода', 'Миллисекунды.', 'debounceMs', 50);
    this.number(c, 'Минимальное количество слов', 'Со скольких слов создаётся новая связь. Уже созданная связь сохраняется до полного удаления.', 'minimumWords', 1);
    this.number(c, 'Минимальная длина строки', 'Минимум символов для создания новой связи.', 'minimumLength', 1);
    this.text(c, 'Исключённые папки', 'Через запятую, относительно корня хранилища.', 'excludedFolders');
  }
  toggle(c, name, desc, key, custom) {
    new Setting(c).setName(name).setDesc(desc).addToggle(t => t.setValue(Boolean(this.plugin.settings[key])).onChange(async v => {
      if (custom) await custom(v); else { this.plugin.settings[key] = v; await this.plugin.saveSettings(); }
    }));
  }
  text(c, name, desc, key) {
    new Setting(c).setName(name).setDesc(desc).addText(t => t.setValue(String(this.plugin.settings[key] ?? '')).onChange(async v => {
      this.plugin.settings[key] = v; await this.plugin.saveSettings();
    }));
  }
  number(c, name, desc, key, min) {
    new Setting(c).setName(name).setDesc(desc).addText(t => t.setValue(String(this.plugin.settings[key])).onChange(async v => {
      const n = Number(v); if (Number.isFinite(n)) { this.plugin.settings[key] = Math.max(min, Math.round(n)); await this.plugin.saveSettings(); }
    }));
  }
}
