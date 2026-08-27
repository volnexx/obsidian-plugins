const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  requestUrl,
  FileSystemAdapter,
  Platform,
  normalizePath,
  setIcon
} = require("obsidian");

const DEFAULT_SETTINGS = {
  registryRepo: "",
  registryBranch: "centralize-plugins",
  backupRoot: "",
  keepBackups: 10,
  fastBackup: true
};

const MAIN_REGISTRY_REPO = "volnexx/obsidian-plugins";
const MOBILE_REGISTRY_REPO = "volnexx/obsidian-plugins-iphone";
const CODEX_LOCK_REL = "dev/.codex-active.json";
const CODEX_LOCK_TOOLTIP = "Обновление заблокировано: работает Codex";
const CODEX_LOCK_NOTICE = "Обновление заблокировано: активна сессия Codex.";
const CODEX_POLL_MS = 3000;
const CODEX_LOCK_STALE_MS = 5 * 60 * 1000;
const CODEX_LOCK_FUTURE_TOLERANCE_MS = 60 * 1000;
const RUNTIME_FILES = ["main.js", "manifest.json", "styles.css"];

// Stable manifest.id values. Folder names and localized display names are deliberately not used.
const PC_ONLY_PLUGIN_IDS = new Set([
  "copilot",
  "gpt-obsidian",
  "memory-monitor-ru",
  "focus-zen-black",
  "lite-tabs",
  "workspace-plus-plus",
  "parsing",
  "obsidian42-brat",
  "mrj-jump-to-link",
  "vault-text-autocomplete"
]);

const PROJECT_EXCLUDED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".parcel-cache",
  ".turbo",
  ".next",
  "coverage",
  "dist",
  "build",
  "build-cache",
  ".eslintcache",
  ".updater-sync",
  "mobile-backups",
  "self-rollback",
  "rollback",
  "backups"
]);

function normalizedProjectPath(value) {
  return String(value || "").replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/^\/+|\/+$/gu, "");
}

function isExcludedProjectPath(value) {
  const p = normalizedProjectPath(value);
  if (!p) return false;
  const parts = p.split("/");
  if (parts.some(part => PROJECT_EXCLUDED_SEGMENTS.has(part))) return true;
  const name = parts[parts.length - 1];
  return name === ".codex-active.json" ||
    name === "data.json" ||
    name === ".DS_Store" ||
    name === "Thumbs.db" ||
    name === "desktop.ini" ||
    /(?:^|[._-])(tmp|temp|cache)(?:$|[._-])/iu.test(name) ||
    /(?:\.log|\.tmp|\.swp|\.swo|~)$/iu.test(name) ||
    /(?:^|\.)(?:conflict|sync-conflict)-/iu.test(name) ||
    /(?:^|[._-])backup(?:[._-]|$)/iu.test(name);
}

function decideSync(devVersion, githubVersion, devHash, githubHash) {
  const order = compareVersions(devVersion, githubVersion);
  if (order > 0) return "dev-to-github";
  if (order < 0) return "github-to-dev";
  return devHash === githubHash ? "noop" : "conflict";
}

function isMobileEligible(manifest) {
  const id = String(manifest?.id || "");
  return !!id && manifest?.isDesktopOnly !== true && !PC_ONLY_PLUGIN_IDS.has(id);
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map(x => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map(x => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function relPath(...parts) {
  const joined = parts
    .filter(v => v !== null && v !== undefined && String(v) !== "")
    .map(v => String(v).replace(/\\/g, "/"))
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return joined ? normalizePath(joined).replace(/^\/+|\/+$/g, "") : "";
}

function relDirname(value) {
  const p = relPath(value);
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function relBasename(value) {
  const p = relPath(value);
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function sameOrInside(value, root) {
  const p = relPath(value);
  const r = relPath(root);
  return !!r && (p === r || p.startsWith(`${r}/`));
}

function codexLockTargetsDev(data, vaultPath = "") {
  if (!data || typeof data !== "object") return false;
  const scope = normalizedProjectPath(data.scope);
  if (scope === "dev" || scope === "dev/**") return true;

  const candidates = [
    ...(Array.isArray(data.paths) ? data.paths : []),
    ...(Array.isArray(data.workingPaths) ? data.workingPaths : []),
    ...(Array.isArray(data.targets) ? data.targets : []),
    data.path,
    data.workspace
  ];
  const vault = normalizedProjectPath(vaultPath);
  return candidates.some(value => {
    let candidate = normalizedProjectPath(value);
    if (!candidate) return false;
    if (vault && (candidate === vault || candidate.startsWith(`${vault}/`))) {
      candidate = candidate === vault ? "" : candidate.slice(vault.length + 1);
    }
    return candidate === "dev" || candidate.startsWith("dev/");
  });
}

function codexLockHeartbeatMs(data) {
  const value = data?.heartbeatAt || data?.startedAt;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function codexLockIsFresh(data, now = Date.now()) {
  const heartbeat = codexLockHeartbeatMs(data);
  if (heartbeat === null) return false;
  const age = Number(now) - heartbeat;
  return age >= -CODEX_LOCK_FUTURE_TOLERANCE_MS && age <= CODEX_LOCK_STALE_MS;
}

class UpdaterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    this.plugin.resetLockButtons();
    containerEl.createEl("h2", { text: "Updater Plugin" });

    new Setting(containerEl)
      .setName("Центральный репозиторий")
      .setDesc(Platform.isDesktopApp
        ? "ПК по умолчанию использует основной репозиторий. Пустое значение возвращает автоматический выбор."
        : "iPhone и Android по умолчанию используют мобильное зеркало. Пустое значение возвращает автоматический выбор.")
      .addText(t => t
        .setValue(this.plugin.settings.registryRepo || "")
        .setPlaceholder(this.plugin.getRegistryRepo())
        .onChange(async v => {
          this.plugin.settings.registryRepo = v.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Ветка плагинов")
      .addText(t => t
        .setValue(this.plugin.settings.registryBranch)
        .onChange(async v => {
          this.plugin.settings.registryBranch = v.trim() || "main";
          await this.plugin.saveSettings();
        }));

    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName("Быстрая резервная копия")
        .setDesc("На Linux используется cp --reflink=auto; если невозможно — обычное копирование.")
        .addToggle(t => t
          .setValue(!!this.plugin.settings.fastBackup)
          .onChange(async v => {
            this.plugin.settings.fastBackup = v;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("Папка резервных копий")
        .setDesc("Пусто = соседняя с хранилищем папка <имя>-backups.")
        .addText(t => t
          .setValue(this.plugin.settings.backupRoot || "")
          .onChange(async v => {
            this.plugin.settings.backupRoot = v.trim();
            await this.plugin.saveSettings();
          }));
    } else {
      new Setting(containerEl)
        .setName("Резервные копии на телефоне")
        .setDesc(`Хранятся внутри ${this.plugin.getMobileBackupRootRel()}. Эта папка исключается из самой резервной копии.`);
    }

    new Setting(containerEl)
      .setName("Хранить последних копий")
      .addText(t => t
        .setValue(String(this.plugin.settings.keepBackups))
        .onChange(async v => {
          this.plugin.settings.keepBackups = Math.max(1, parseInt(v, 10) || 10);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Обновить всё")
      .setDesc(Platform.isDesktopApp
        ? "Одна кнопка: dev ↔ основной GitHub → runtime; совместимые плагины также публикуются в iPhone-зеркало."
        : "Одна резервная копия → обновление и установка из мобильного зеркала.")
      .addButton(b => {
        b.setButtonText("Обновить всё")
          .setCta()
          .onClick(() => this.plugin.safeUpdateAll());
        this.plugin.registerLockButton(b);
      });

    new Setting(containerEl)
      .setName("Проверить обновления")
      .addButton(b => {
        b.setButtonText("Проверить")
          .onClick(() => this.plugin.checkOnly());
        this.plugin.registerLockButton(b);
      });
  }
}

module.exports = class UpdaterPlugin extends Plugin {
  async onload() {
    this.isDesktopApp = !!Platform.isDesktopApp;
    this.adapter = this.app.vault.adapter;
    this.node = null;

    if (this.isDesktopApp) {
      if (!(this.adapter instanceof FileSystemAdapter) || typeof this.adapter.getBasePath !== "function") {
        throw new Error("Настольный Updater не получил FileSystemAdapter.");
      }
      const fs = require("fs");
      this.node = {
        fs,
        fsp: fs.promises,
        path: require("path"),
        crypto: require("crypto"),
        os: require("os"),
        spawn: require("child_process").spawn
      };
    }

    await this.loadSettings();

    this._restoreActionElements = new Set();
    this._restoreActionsByView = new WeakMap();
    this.app.workspace?.onLayoutReady?.(() => { void this.refreshRestoreActions(); });
    if (this.app.workspace?.on) {
      this.registerEvent(this.app.workspace.on("layout-change", () => { void this.refreshRestoreActions(); }));
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => { void this.refreshRestoreActions(); }));
    }

    this._lockButtons = new Set();
    this._codexBlocked = false;
    const updateRibbon = this.addRibbonIcon("refresh-cw", "Обновить все наши плагины", () => this.safeUpdateAll());
    this._updateRibbon = updateRibbon || null;
    if (updateRibbon) {
      updateRibbon.style.position = "relative";
      const mark = document.createElement("span");
      mark.textContent = "P";
      mark.setAttribute("aria-hidden", "true");
      Object.assign(mark.style, {
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        fontSize: "8px",
        lineHeight: "1",
        fontWeight: "800",
        fontFamily: "var(--font-interface)",
        color: "currentColor",
        pointerEvents: "none",
        zIndex: "2"
      });
      updateRibbon.appendChild(mark);
    }

    this.addCommand({
      id: "safe-update-all-custom-plugins",
      name: "Обновить все наши плагины безопасно",
      callback: () => this.safeUpdateAll()
    });

    this.addCommand({
      id: "check-all-custom-plugin-updates",
      name: "Проверить обновления наших плагинов",
      callback: () => this.checkOnly()
    });

    this._settingTab = new UpdaterSettingTab(this.app, this);
    this.addSettingTab(this._settingTab);
    if (this.isDesktopApp) this.setupCodexStateMonitoring();
  }

  onunload() {
    try { this._codexLockWatcher?.close?.(); } catch {}
    this._codexLockWatcher = null;
    for (const el of this._restoreActionElements || []) {
      try { el.remove(); } catch {}
    }
    this._restoreActionElements?.clear();
  }

  async loadSettings() {
    const loaded = await this.loadData() || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    // Old data stored the main repository explicitly. Treat both official repositories as
    // automatic defaults so the same data.json works on desktop and mobile without editing.
    if (this.settings.registryRepo === MAIN_REGISTRY_REPO || this.settings.registryRepo === MOBILE_REGISTRY_REPO) {
      this.settings.registryRepo = "";
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getRegistryRepo() {
    return this.settings?.registryRepo || (this.isDesktopApp ? MAIN_REGISTRY_REPO : MOBILE_REGISTRY_REPO);
  }

  resetLockButtons() {
    this._lockButtons ||= new Set();
    this._lockButtons.clear();
  }

  registerLockButton(button) {
    this._lockButtons ||= new Set();
    this._lockButtons.add(button);
    try { button.setDisabled?.(!!this._codexBlocked); } catch {}
  }

  getCodexLockPath() {
    if (!this.isDesktopApp || !this.node) return null;
    return this.node.path.join(this.getDesktopVaultPath(), ...CODEX_LOCK_REL.split("/"));
  }

  async readCodexLock() {
    const lockPath = this.getCodexLockPath();
    if (!lockPath) return null;
    try {
      const text = await this.node.fsp.readFile(lockPath, "utf8");
      return { path: lockPath, data: JSON.parse(text) };
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("[Updater Plugin] Codex lock read failed:", error);
      return null;
    }
  }

  async removeStaleCodexLock(lock) {
    try { await this.node.fsp.rm(lock.path, { force: true }); }
    catch (error) { console.warn("[Updater Plugin] stale Codex lock removal failed:", error); }
  }

  async getCodexLockState(now = Date.now()) {
    if (!this.isDesktopApp || !this.node) return { active: false, reason: "mobile" };
    const lock = await this.readCodexLock();
    if (!lock) return { active: false, reason: "no-lock" };

    if (!codexLockTargetsDev(lock.data, this.getDesktopVaultPath())) {
      await this.removeStaleCodexLock(lock);
      return { active: false, reason: "non-dev-lock-removed" };
    }
    if (!codexLockIsFresh(lock.data, now)) {
      await this.removeStaleCodexLock(lock);
      return { active: false, reason: "stale-lock-removed" };
    }
    return { active: true, reason: "fresh-dev-lock", lock };
  }

  updateCodexUi(active) {
    this._codexBlocked = !!active;
    const ribbon = this._updateRibbon;
    if (ribbon) {
      ribbon.classList?.toggle("updater-plugin-codex-locked", !!active);
      ribbon.setAttribute?.("aria-disabled", active ? "true" : "false");
      ribbon.setAttribute?.("aria-label", active ? CODEX_LOCK_TOOLTIP : "Обновить все наши плагины");
      ribbon.setAttribute?.("data-tooltip-position", "right");
    }
    for (const button of this._lockButtons || []) {
      try { button.setDisabled?.(!!active); } catch {}
    }
  }

  async refreshCodexState() {
    if (!this.isDesktopApp) return false;
    const state = await this.getCodexLockState();
    this.updateCodexUi(state.active);
    return state.active;
  }

  setupCodexLockWatcher() {
    if (!this.isDesktopApp || !this.node || this._codexLockWatcher) return;
    const lockPath = this.getCodexLockPath();
    if (!lockPath) return;
    try {
      const lockName = this.node.path.basename(lockPath);
      this._codexLockWatcher = this.node.fs.watch(
        this.node.path.dirname(lockPath),
        { persistent: false },
        (_event, filename) => {
          if (!filename || String(filename) === lockName) void this.refreshCodexState();
        }
      );
    } catch (error) {
      console.warn("[Updater Plugin] Codex lock watcher unavailable; polling remains active:", error);
    }
  }

  setupCodexStateMonitoring() {
    this.setupCodexLockWatcher();
    void this.refreshCodexState();
    const timer = window.setInterval(() => { void this.refreshCodexState(); }, CODEX_POLL_MS);
    this.registerInterval?.(timer);
  }

  async assertUpdateUnlocked(notify = true) {
    if (!this.isDesktopApp) return true;
    const state = await this.getCodexLockState();
    this.updateCodexUi(state.active);
    if (!state.active) return true;
    if (notify) new Notice(CODEX_LOCK_NOTICE, 8000);
    return false;
  }

  getConfigDirRel() {
    return relPath(this.app.vault.configDir || ".obsidian");
  }

  getPluginsRootRel() {
    return relPath(this.getConfigDirRel(), "plugins");
  }

  getUpdaterDirRel() {
    return relPath(this.getPluginsRootRel(), this.manifest.id);
  }

  getMobileBackupRootRel() {
    return relPath(this.getUpdaterDirRel(), "mobile-backups");
  }

  getCommunityPluginsPathRel() {
    return relPath(this.getConfigDirRel(), "community-plugins.json");
  }

  getDesktopVaultPath() {
    if (!this.isDesktopApp || !this.node) throw new Error("Настольный путь недоступен на мобильном устройстве.");
    return this.adapter.getBasePath();
  }

  getDesktopBackupRoot() {
    const { path } = this.node;
    const vault = this.getDesktopVaultPath();
    return this.settings.backupRoot
      ? path.resolve(this.settings.backupRoot)
      : path.join(path.dirname(vault), `${path.basename(vault)}-backups`);
  }

  async adapterExists(p) {
    return this.adapter.exists(relPath(p));
  }

  async ensureAdapterDir(p) {
    const target = relPath(p);
    if (!target) return;
    let current = "";
    for (const part of target.split("/")) {
      current = relPath(current, part);
      if (!(await this.adapter.exists(current))) {
        try { await this.adapter.mkdir(current); }
        catch (e) {
          if (!(await this.adapter.exists(current))) throw e;
        }
      }
    }
  }

  async adapterReadText(p) {
    return this.adapter.read(relPath(p));
  }

  async adapterWriteText(p, data) {
    const target = relPath(p);
    await this.ensureAdapterDir(relDirname(target));
    await this.adapter.write(target, String(data));
  }

  async adapterCopyFile(src, dst) {
    const source = relPath(src);
    const target = relPath(dst);
    await this.ensureAdapterDir(relDirname(target));
    const data = await this.adapter.readBinary(source);
    await this.adapter.writeBinary(target, data);
  }

  async adapterRemove(p, recursive = false) {
    const target = relPath(p);
    if (!target || !(await this.adapter.exists(target))) return;
    const stat = await this.adapter.stat(target);
    if (stat?.type === "folder") await this.adapter.rmdir(target, !!recursive);
    else await this.adapter.remove(target);
  }

  async adapterList(p) {
    return this.adapter.list(relPath(p));
  }

  async copyAdapterTree(src, dst, excludedSourceRoots = []) {
    const source = relPath(src);
    const target = relPath(dst);
    if (excludedSourceRoots.some(root => sameOrInside(source, root))) return;
    await this.ensureAdapterDir(target);
    const listed = await this.adapterList(source);

    for (const folder of listed.folders || []) {
      if (excludedSourceRoots.some(root => sameOrInside(folder, root))) continue;
      await this.copyAdapterTree(folder, relPath(target, relBasename(folder)), excludedSourceRoots);
    }
    for (const file of listed.files || []) {
      if (excludedSourceRoots.some(root => sameOrInside(file, root))) continue;
      await this.adapterCopyFile(file, relPath(target, relBasename(file)));
    }
  }

  async mirrorSnapshotToVault(snapshotRoot, relative = "") {
    const protectedRoot = this.getUpdaterDirRel();
    const destDir = relPath(relative);
    if (sameOrInside(destDir, protectedRoot)) return;

    const srcDir = relPath(snapshotRoot, relative);
    if (destDir) await this.ensureAdapterDir(destDir);

    const src = await this.adapterList(srcDir);
    const dst = await this.adapterList(destDir);
    const srcFileNames = new Set((src.files || []).map(relBasename));
    const srcFolderNames = new Set((src.folders || []).map(relBasename));

    for (const file of dst.files || []) {
      const name = relBasename(file);
      const destPath = relPath(destDir, name);
      if (sameOrInside(destPath, protectedRoot)) continue;
      if (!srcFileNames.has(name)) await this.adapterRemove(destPath, false);
    }

    for (const folder of dst.folders || []) {
      const name = relBasename(folder);
      const destPath = relPath(destDir, name);
      if (sameOrInside(destPath, protectedRoot)) continue;
      if (!srcFolderNames.has(name)) await this.adapterRemove(destPath, true);
    }

    for (const folder of src.folders || []) {
      const name = relBasename(folder);
      const childRel = relPath(relative, name);
      if (sameOrInside(childRel, protectedRoot)) continue;
      await this.mirrorSnapshotToVault(snapshotRoot, childRel);
    }

    for (const file of src.files || []) {
      const name = relBasename(file);
      const destPath = relPath(relative, name);
      if (sameOrInside(destPath, protectedRoot)) continue;
      await this.adapterCopyFile(file, destPath);
    }
  }

  runDesktopCommand(command, args) {
    return this.runDesktopProcess(command, args).then(() => undefined);
  }

  runDesktopProcess(command, args, options = {}) {
    if (!this.node) return Promise.reject(new Error("Настольные команды недоступны."));
    const { spawn } = this.node;
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(options.env || {}) },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", d => stdout += String(d));
      child.stderr.on("data", d => stderr += String(d));
      child.on("error", reject);
      child.on("close", code => code === 0
        ? resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code })
        : reject(new Error(`${command}: ${(stderr || stdout).trim()}`)));
    });
  }

  isRetryableNetworkError(error) {
    const message = String(error?.message || error || "");
    const explicitStatus = Number(error?.status || 0);
    const match = message.match(/(?:status|HTTP)\s*(\d{3})/iu);
    const status = explicitStatus || Number(match?.[1] || 0);
    return status === 408 || status === 425 || status === 429 || status >= 500 && status <= 599;
  }

  async requestWithRetry(makeOptions, label, attempts = 4) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const r = await requestUrl(makeOptions());
        if (r.status >= 200 && r.status < 300) return r;
        const error = new Error(`${label}: HTTP ${r.status}`);
        error.status = r.status;
        throw error;
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !this.isRetryableNetworkError(error)) throw error;
        const delay = 500 * (2 ** (attempt - 1));
        console.warn(`[Updater Plugin] ${label}: временная ошибка, повтор ${attempt}/${attempts} через ${delay} мс`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError || new Error(`${label}: запрос не выполнен.`);
  }

  decodeBase64Utf8(value) {
    const compact = String(value || "").replace(/\s+/gu, "");
    const binary = globalThis.atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  async rawText(repo, ref, file) {
    const [owner, repository] = String(repo || "").split("/");
    if (!owner || !repository) throw new Error("Репозиторий должен быть owner/repository.");
    const encodedPath = String(file || "")
      .split("/")
      .filter(Boolean)
      .map(part => encodeURIComponent(part))
      .join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
    const data = await this.githubJson(url);
    if (!data || data.type !== "file") throw new Error(`${repo}/${file}: GitHub API не вернул файл.`);
    if (data.encoding !== "base64" || typeof data.content !== "string") {
      throw new Error(`${repo}/${file}: неподдерживаемый формат содержимого GitHub API.`);
    }
    return this.decodeBase64Utf8(data.content);
  }

  async githubJson(url) {
    const r = await this.requestWithRetry(() => {
      const sep = url.includes("?") ? "&" : "?";
      const freshUrl = `${url}${sep}updater=${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        url: freshUrl,
        method: "GET",
        headers: {
          "Accept": "application/vnd.github+json",
          "User-Agent": "Updater-Plugin",
          "Cache-Control": "no-cache, no-store, max-age=0",
          "Pragma": "no-cache"
        }
      };
    }, "GitHub API");
    return r.json;
  }

  async resolveRepositoryRevision(owner, repo, branch) {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`;
    const commit = await this.githubJson(url);
    const sha = String(commit?.sha || "").trim();
    if (!/^[0-9a-f]{40}$/iu.test(sha)) throw new Error(`Не удалось определить последний commit SHA ветки ${branch}.`);
    return sha;
  }

  async listRepositoryPluginFolders() {
    const registryRepo = this.getRegistryRepo();
    const [owner, repo] = String(registryRepo || "").split("/");
    if (!owner || !repo) throw new Error("Центральный репозиторий должен быть owner/repository.");
    const branch = this.settings.registryBranch || "main";
    const revision = await this.resolveRepositoryRevision(owner, repo, branch);
    const registryText = await this.rawText(registryRepo, revision, "registry.json");
    let registry;
    try {
      registry = JSON.parse(registryText);
    } catch {
      throw new Error("registry.json содержит некорректный JSON.");
    }
    if (!registry || !Array.isArray(registry.plugins)) throw new Error("registry.json не содержит список plugins.");

    const plugins = registry.plugins
      .filter(entry => entry && entry.id && entry.version && entry.path)
      .map(entry => ({
        id: String(entry.id),
        name: String(entry.name || entry.id),
        version: String(entry.version),
        path: String(entry.path),
        manifest: {
          id: String(entry.id),
          name: String(entry.name || entry.id),
          version: String(entry.version),
          isDesktopOnly: entry.isDesktopOnly === true
        },
        sourceRef: revision,
        sourcePath: entry.sourcePath ? String(entry.sourcePath) : "",
        sourceHash: entry.sourceHash ? String(entry.sourceHash) : "",
        runtimeHash: entry.runtimeHash ? String(entry.runtimeHash) : "",
        sourceComplete: entry.sourceComplete === true,
        mobile: entry.mobile === true,
        runtimeFiles: Array.isArray(entry.runtimeFiles) ? entry.runtimeFiles.map(String) : RUNTIME_FILES
      }));

    new Notice(`Реестр загружен: ${plugins.length} плагинов.`);
    return plugins;
  }

  async readInstalledPlugins() {
    const root = this.getPluginsRootRel();
    const result = new Map();
    if (!(await this.adapterExists(root))) return result;

    const listed = await this.adapterList(root);
    await Promise.all((listed.folders || []).map(async folderPath => {
      const manifestPath = relPath(folderPath, "manifest.json");
      if (!(await this.adapterExists(manifestPath))) return;
      try {
        const m = JSON.parse(await this.adapterReadText(manifestPath));
        if (!m?.id) return;
        result.set(m.id, {
          id: m.id,
          name: m.name || m.id,
          version: m.version || "0.0.0",
          dir: relPath(folderPath),
          folderName: relBasename(folderPath),
          manifest: m
        });
      } catch {}
    }));
    return result;
  }

  normalizePluginIdentity(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9а-яё]+/giu, "");
  }

  pluginNameTokens(value) {
    const stop = new Set(["obsidian", "plugin", "plugins", "плагин", "плагины"]);
    const words = String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9а-яё]+/giu) || [];
    return new Set(words.filter(word => word.length >= 2 && !stop.has(word)));
  }

  matchRemoteToLocal(entry, installed) {
    const exact = installed.get(entry.id);
    if (exact) return { local: exact, matchedBy: "id", ambiguous: false };

    const locals = Array.from(installed.values());
    const remoteFolder = this.normalizePluginIdentity(relBasename(entry.path));
    if (remoteFolder) {
      const matches = locals.filter(local => this.normalizePluginIdentity(local.folderName) === remoteFolder);
      if (matches.length === 1) return { local: matches[0], matchedBy: "folder", ambiguous: false };
      if (matches.length > 1) return { local: null, matchedBy: "folder", ambiguous: true };
    }

    const remoteName = this.normalizePluginIdentity(entry.name || entry.manifest?.name);
    if (remoteName) {
      const matches = locals.filter(local => this.normalizePluginIdentity(local.name || local.manifest?.name) === remoteName);
      if (matches.length === 1) return { local: matches[0], matchedBy: "name", ambiguous: false };
      if (matches.length > 1) return { local: null, matchedBy: "name", ambiguous: true };
    }

    const remoteAuthor = this.normalizePluginIdentity(entry.manifest?.author);
    const remoteTokens = this.pluginNameTokens(entry.name || entry.manifest?.name);
    if (remoteAuthor && remoteTokens.size) {
      const legacy = locals.filter(local => {
        const localAuthor = this.normalizePluginIdentity(local.manifest?.author);
        if (!localAuthor || localAuthor !== remoteAuthor) return false;
        const localTokens = this.pluginNameTokens(local.name || local.manifest?.name);
        if (!localTokens.size) return false;
        const shared = [...remoteTokens].filter(token => localTokens.has(token));
        const coverage = shared.length / Math.min(remoteTokens.size, localTokens.size);
        return shared.length >= 2 && coverage >= 0.5;
      });
      if (legacy.length === 1) return { local: legacy[0], matchedBy: "author+name", ambiguous: false };
      if (legacy.length > 1) return { local: null, matchedBy: "author+name", ambiguous: true };
    }

    return { local: null, matchedBy: "none", ambiguous: false };
  }

  async resolveRegistryPlugins() {
    const [remote, installed] = await Promise.all([
      this.listRepositoryPluginFolders(),
      this.readInstalledPlugins()
    ]);

    const all = remote.map(entry => {
      const match = this.matchRemoteToLocal(entry, installed);
      return { entry, local: match.local, matchedBy: match.matchedBy, ambiguous: match.ambiguous };
    });

    return {
      all,
      installed: all.filter(x => x.local && !x.ambiguous),
      missing: all.filter(x => !x.local && !x.ambiguous),
      ambiguous: all.filter(x => x.ambiguous)
    };
  }

  sourceFor(entry) {
    return {
      repo: this.getRegistryRepo(),
      branch: entry.sourceRef || this.settings.registryBranch || "main",
      prefix: entry.path ? `${String(entry.path).replace(/\/+$/u, "")}/` : ""
    };
  }

  async readDesktopJson(file) {
    return JSON.parse(await this.node.fsp.readFile(file, "utf8"));
  }

  async writeDesktopTextAtomic(file, text) {
    const { fsp, path } = this.node;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(temp, String(text), "utf8");
    await fsp.rename(temp, file);
  }

  async writeDesktopJsonAtomic(file, value) {
    await this.writeDesktopTextAtomic(file, JSON.stringify(value, null, 2) + "\n");
  }

  async collectProjectFiles(root, relative = "", result = []) {
    const { fsp, path } = this.node;
    const dir = relative ? path.join(root, ...relative.split("/")) : root;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const rel = normalizedProjectPath(relative ? `${relative}/${entry.name}` : entry.name);
      if (isExcludedProjectPath(rel)) continue;
      if (entry.isDirectory()) await this.collectProjectFiles(root, rel, result);
      else if (entry.isFile()) result.push(rel);
    }
    return result;
  }

  async hashSelectedFiles(root, files) {
    const { fsp, path, crypto } = this.node;
    const hash = crypto.createHash("sha256");
    const sorted = [...files].map(normalizedProjectPath).filter(Boolean).sort((a, b) => a.localeCompare(b, "en"));
    for (const rel of sorted) {
      const data = await fsp.readFile(path.join(root, ...rel.split("/")));
      hash.update(rel, "utf8");
      hash.update("\0");
      hash.update(String(data.length), "utf8");
      hash.update("\0");
      hash.update(data);
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  async hashProject(root) {
    return this.hashSelectedFiles(root, await this.collectProjectFiles(root));
  }

  async existingRuntimeFiles(root) {
    const files = [];
    for (const name of RUNTIME_FILES) {
      if (await this.desktopExists(this.node.path.join(root, name))) files.push(name);
    }
    if (!files.includes("manifest.json") || !files.includes("main.js")) {
      throw new Error(`${root}: нет обязательных manifest.json/main.js.`);
    }
    return files;
  }

  async hashRuntime(root, files = null) {
    return this.hashSelectedFiles(root, files || await this.existingRuntimeFiles(root));
  }

  async copyProjectTree(source, destination) {
    const { fsp, path } = this.node;
    await fsp.rm(destination, { recursive: true, force: true });
    await fsp.mkdir(destination, { recursive: true });
    const files = await this.collectProjectFiles(source);
    for (const rel of files) {
      const from = path.join(source, ...rel.split("/"));
      const to = path.join(destination, ...rel.split("/"));
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(from, to);
    }
    return files;
  }

  getDevRoot() {
    return this.node.path.join(this.getDesktopVaultPath(), "dev");
  }

  getDesktopSyncRoot() {
    return this.node.path.join(this.getDesktopVaultPath(), ...this.getUpdaterDirRel().split("/"), ".updater-sync");
  }

  async listDevProjects() {
    const { fsp, path } = this.node;
    const root = this.getDevRoot();
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const projects = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (!entry.isDirectory() || isExcludedProjectPath(entry.name)) continue;
      const dir = path.join(root, entry.name);
      const manifestPath = path.join(dir, "manifest.json");
      if (!(await this.desktopExists(manifestPath))) continue;
      const manifest = await this.readDesktopJson(manifestPath);
      if (!manifest?.id || !manifest?.version) continue;
      projects.push({ dir, folderName: entry.name, manifest, id: String(manifest.id), version: String(manifest.version) });
    }
    return projects;
  }

  async loadDesktopSyncPolicy() {
    const file = this.node.path.join(this.getDevRoot(), ".plugin-sync-policy.json");
    try { return await this.readDesktopJson(file); }
    catch (error) {
      if (error?.code === "ENOENT") return { schemaVersion: 1, blocked: {} };
      throw new Error(`Не удалось прочитать dev/.plugin-sync-policy.json: ${error.message}`);
    }
  }

  projectCommands(packageJson) {
    const scripts = packageJson?.scripts || {};
    if (scripts.verify) return [["npm", ["run", "verify"]]];
    if (scripts.check) return [["npm", ["run", "check"]]];
    const commands = [];
    for (const name of ["lint", "test", "build"]) {
      if (scripts[name]) commands.push(["npm", ["run", name]]);
    }
    return commands;
  }

  async runProjectChecks(projectDir) {
    const { fsp, path } = this.node;
    const packagePath = path.join(projectDir, "package.json");
    if (await this.desktopExists(packagePath)) {
      const packageJson = await this.readDesktopJson(packagePath);
      for (const [command, args] of this.projectCommands(packageJson)) {
        await this.runDesktopProcess(command, args, { cwd: projectDir });
      }
    } else if (await this.desktopExists(path.join(projectDir, "main.test.js"))) {
      await this.runDesktopProcess(process.execPath, ["--test", "main.test.js"], { cwd: projectDir });
    }
    await this.runDesktopProcess(process.execPath, ["--check", "main.js"], { cwd: projectDir });
  }

  async ensureGitCheckout(repo, branch, key) {
    const { fsp, path } = this.node;
    const root = this.getDesktopSyncRoot();
    const checkout = path.join(root, key);
    await fsp.mkdir(root, { recursive: true });
    if (!(await this.desktopExists(path.join(checkout, ".git")))) {
      await fsp.rm(checkout, { recursive: true, force: true });
      await this.runDesktopProcess("git", ["clone", "--single-branch", "--branch", branch, `https://github.com/${repo}.git`, checkout]);
    }
    const status = await this.runDesktopProcess("git", ["status", "--porcelain"], { cwd: checkout });
    if (status.stdout) throw new Error(`${repo}: служебный checkout содержит незавершённые изменения.`);
    await this.runDesktopProcess("git", ["fetch", "origin", branch], { cwd: checkout });
    await this.runDesktopProcess("git", ["checkout", branch], { cwd: checkout });
    await this.runDesktopProcess("git", ["merge", "--ff-only", `origin/${branch}`], { cwd: checkout });
    return checkout;
  }

  async gitHead(checkout) {
    return (await this.runDesktopProcess("git", ["rev-parse", "HEAD"], { cwd: checkout })).stdout;
  }

  async pushAndVerify(checkout, branch) {
    const localSha = await this.gitHead(checkout);
    await this.runDesktopProcess("git", ["push", "origin", `HEAD:${branch}`], { cwd: checkout });
    const remote = await this.runDesktopProcess("git", ["ls-remote", "origin", `refs/heads/${branch}`], { cwd: checkout });
    const remoteSha = String(remote.stdout || "").split(/\s+/u)[0];
    if (remoteSha !== localSha) throw new Error(`Push не подтверждён: local ${localSha}, remote ${remoteSha || "нет SHA"}.`);
    return localSha;
  }

  async commitCheckout(checkout, message) {
    await this.runDesktopProcess("git", ["add", "-A"], { cwd: checkout });
    const diff = await this.runDesktopProcess("git", ["diff", "--cached", "--quiet"], { cwd: checkout })
      .then(() => false)
      .catch(() => true);
    if (!diff) return null;
    const hasName = await this.runDesktopProcess("git", ["config", "--get", "user.name"], { cwd: checkout }).then(() => true).catch(() => false);
    const hasEmail = await this.runDesktopProcess("git", ["config", "--get", "user.email"], { cwd: checkout }).then(() => true).catch(() => false);
    if (!hasName) await this.runDesktopProcess("git", ["config", "user.name", "volnexx"], { cwd: checkout });
    if (!hasEmail) await this.runDesktopProcess("git", ["config", "user.email", "forscript2575@gmail.com"], { cwd: checkout });
    await this.runDesktopProcess("git", ["commit", "-m", message], { cwd: checkout });
    return this.gitHead(checkout);
  }

  async readCheckoutRegistry(checkout) {
    const file = this.node.path.join(checkout, "registry.json");
    const registry = await this.readDesktopJson(file);
    if (!Array.isArray(registry?.plugins)) throw new Error("registry.json не содержит plugins.");
    return { file, registry };
  }

  async stageMainRepositoryPlugin(checkout, project, entry = null) {
    const { fsp, path } = this.node;
    const pluginPath = String(entry?.path || project.id);
    if (!/^[a-z0-9][a-z0-9_/-]*$/iu.test(pluginPath) || pluginPath.includes("..")) {
      throw new Error(`${project.id}: небезопасный путь репозитория ${pluginPath}.`);
    }
    const finalDir = path.join(checkout, ...pluginPath.split("/"));
    const stageDir = path.join(checkout, `.updater-stage-${project.id}-${Date.now()}`);
    await fsp.mkdir(stageDir, { recursive: true });
    await fsp.mkdir(path.dirname(finalDir), { recursive: true });
    if (await this.desktopExists(finalDir)) {
      for (const oldEntry of await fsp.readdir(finalDir, { withFileTypes: true })) {
        await fsp.cp(path.join(finalDir, oldEntry.name), path.join(stageDir, oldEntry.name), { recursive: true, force: true });
      }
    }
    const runtimeFiles = await this.existingRuntimeFiles(project.dir);
    for (const name of runtimeFiles) await fsp.copyFile(path.join(project.dir, name), path.join(stageDir, name));
    const sourcePath = path.join(stageDir, "dev-source");
    await this.copyProjectTree(project.dir, sourcePath);
    const sourceHash = await this.hashProject(sourcePath);
    const runtimeHash = await this.hashRuntime(stageDir, runtimeFiles);
    const oldDir = `${finalDir}.updater-old-${Date.now()}`;
    if (await this.desktopExists(finalDir)) await fsp.rename(finalDir, oldDir);
    try {
      await fsp.rename(stageDir, finalDir);
      if (await this.desktopExists(oldDir)) await fsp.rm(oldDir, { recursive: true, force: true });
    } catch (error) {
      if (await this.desktopExists(finalDir)) await fsp.rm(finalDir, { recursive: true, force: true });
      if (await this.desktopExists(oldDir)) await fsp.rename(oldDir, finalDir);
      throw error;
    }
    return {
      id: project.id,
      name: project.manifest.name || project.id,
      version: project.version,
      path: pluginPath,
      sourcePath: `${pluginPath}/dev-source`,
      sourceHash,
      runtimeHash,
      runtimeFiles,
      sourceComplete: true,
      isDesktopOnly: project.manifest.isDesktopOnly === true,
      mobile: isMobileEligible(project.manifest)
    };
  }

  async pluginFilesDiffer(info) {
    const { entry, local } = info;
    const source = this.sourceFor(entry);
    try {
      const [remoteMain, remoteManifestText, remoteStyles] = await Promise.all([
        this.rawText(source.repo, source.branch, `${source.prefix}main.js`),
        this.rawText(source.repo, source.branch, `${source.prefix}manifest.json`),
        this.rawText(source.repo, source.branch, `${source.prefix}styles.css`)
          .then(text => ({ exists: true, text }))
          .catch(() => ({ exists: false, text: "" }))
      ]);

      const localMainPath = relPath(local.dir, "main.js");
      const localManifestPath = relPath(local.dir, "manifest.json");
      const localStylesPath = relPath(local.dir, "styles.css");
      if (!(await this.adapterExists(localMainPath)) || !(await this.adapterExists(localManifestPath))) return true;

      const [localMain, localManifestText] = await Promise.all([
        this.adapterReadText(localMainPath),
        this.adapterReadText(localManifestPath)
      ]);
      if (localMain !== remoteMain) return true;

      let remoteManifest;
      let localManifest;
      try {
        remoteManifest = JSON.parse(remoteManifestText);
        localManifest = JSON.parse(localManifestText);
      } catch {
        return true;
      }

      for (const key of ["id", "name", "version", "minAppVersion", "description", "author", "isDesktopOnly"]) {
        if (JSON.stringify(remoteManifest?.[key]) !== JSON.stringify(localManifest?.[key])) return true;
      }

      const localHasStyles = await this.adapterExists(localStylesPath);
      if (remoteStyles.exists !== localHasStyles) return true;
      if (remoteStyles.exists && await this.adapterReadText(localStylesPath) !== remoteStyles.text) return true;
      return false;
    } catch (e) {
      console.warn(`[Updater Plugin] integrity check skipped for ${local?.name || entry?.name}:`, e);
      return false;
    }
  }

  async findUpdates(plugins) {
    return plugins
      .map(p => compareVersions(p.entry.version, p.local.version) > 0
        ? { ...p, updateReason: "version" }
        : null)
      .filter(Boolean);
  }

  async checkOnly() {
    if (!(await this.assertUpdateUnlocked(true))) return;
    if (this._busy) {
      new Notice("Операция уже выполняется.");
      return;
    }
    this._busy = true;
    try {
      if (this.isDesktopApp) {
        const branch = this.settings.registryBranch || "centralize-plugins";
        const checkout = await this.ensureGitCheckout(MAIN_REGISTRY_REPO, branch, "main");
        const plan = await this.buildDesktopSyncPlan(checkout);
        const count = decision => plan.items.filter(item => item.decision === decision).length;
        new Notice(`План синхронизации. dev → GitHub: ${count("dev-to-github")}; GitHub → dev: ${count("github-to-dev")}; без изменений: ${count("noop")}; конфликтов: ${count("conflict")}; пропущено политикой: ${count("blocked")}.`, 12000);
        return;
      }
      const discovered = await this.resolveRegistryPlugins();
      const updates = await this.findUpdates(discovered.installed);
      const newPlugins = discovered.missing;
      if (!updates.length && !newPlugins.length) {
        new Notice(`В репозитории: ${discovered.all.length}; установлено: ${discovered.installed.length}; обновлений и новых плагинов нет.`);
        return;
      }
      const parts = [];
      if (updates.length) {
        parts.push(`Обновлений: ${updates.length}. ${updates.map(p => p.updateReason === "files" ? `${p.local.name} ${p.local.version} — файлы отличаются` : `${p.local.name} ${p.local.version} → ${p.entry.version}`).join("; ")}`);
      }
      if (newPlugins.length) parts.push(`Новых плагинов: ${newPlugins.length}. ${newPlugins.map(p => p.entry.name).join("; ")}`);
      if (discovered.ambiguous.length) parts.push(`Неоднозначных совпадений: ${discovered.ambiguous.length}; пропущены.`);
      new Notice(parts.join(" "), 12000);
    } catch (e) {
      console.error("[Updater Plugin]", e);
      new Notice(`Ошибка проверки: ${e.message}`, 10000);
    } finally {
      this._busy = false;
    }
  }

  async createDesktopVaultBackup(suffix = "_before-update") {
    const { fsp, path } = this.node;
    const vault = this.getDesktopVaultPath();
    const root = this.getDesktopBackupRoot();
    await fsp.mkdir(root, { recursive: true });
    const dst = path.join(root, `${stamp()}${suffix}`);

    let method = "обычное копирование";
    if (this.settings.fastBackup && Platform.isLinux) {
      try {
        await fsp.mkdir(dst, { recursive: true });
        await this.runDesktopCommand("cp", ["-a", "--reflink=auto", `${vault}/.`, dst]);
        method = "reflink/cp";
      } catch {
        await fsp.rm(dst, { recursive: true, force: true });
        await fsp.cp(vault, dst, { recursive: true, force: true, errorOnExist: false });
      }
    } else {
      await fsp.cp(vault, dst, { recursive: true, force: true, errorOnExist: false });
    }

    await fsp.writeFile(path.join(dst, "_updater-plugin-backup.json"), JSON.stringify({
      createdAt: new Date().toISOString(),
      sourceVault: vault,
      updaterVersion: this.manifest.version,
      platform: "desktop",
      method
    }, null, 2), "utf8");

    if (!(await this.desktopExists(path.join(dst, this.getConfigDirRel())))) throw new Error(`Проверка резервной копии не пройдена: нет ${this.getConfigDirRel()}.`);
    return { path: dst, method };
  }

  async desktopExists(p) {
    try { await this.node.fsp.access(p); return true; } catch { return false; }
  }

  async createMobileVaultBackup(suffix = "_before-update") {
    const root = this.getMobileBackupRootRel();
    await this.ensureAdapterDir(root);
    const dst = relPath(root, `${stamp()}${suffix}`);
    await this.ensureAdapterDir(dst);
    await this.copyAdapterTree("", dst, [root]);
    await this.adapterWriteText(relPath(dst, "_updater-plugin-backup.json"), JSON.stringify({
      createdAt: new Date().toISOString(),
      updaterVersion: this.manifest.version,
      platform: Platform.isIosApp ? "ios" : "mobile",
      method: "Vault.adapter"
    }, null, 2));
    if (!(await this.adapterExists(relPath(dst, this.getConfigDirRel())))) throw new Error(`Проверка резервной копии не пройдена: нет ${this.getConfigDirRel()}.`);
    return { path: dst, method: "Vault.adapter" };
  }

  async createVaultBackup() {
    const started = Date.now();
    try {
      new Notice(this.isDesktopApp ? "Создаю резервную копию…" : "Создаю мобильную резервную копию…");
      const result = this.isDesktopApp
        ? await this.createDesktopVaultBackup("_before-update")
        : await this.createMobileVaultBackup("_before-update");
      await this.pruneBackups();
      new Notice(`Копия готова за ${((Date.now() - started) / 1000).toFixed(1)} с (${result.method}).`);
      return result.path;
    } catch (e) {
      console.error("[Updater Plugin] backup failed:", e);
      new Notice(`Копия не создана. Обновление отменено: ${e.message}`, 10000);
      return null;
    }
  }

  async pruneBackups() {
    const keep = Math.max(1, this.settings.keepBackups || 10);
    if (this.isDesktopApp) {
      const { fsp, path } = this.node;
      const root = this.getDesktopBackupRoot();
      if (!(await this.desktopExists(root))) return;
      const dirs = (await fsp.readdir(root, { withFileTypes: true }))
        .filter(e => e.isDirectory() && e.name.endsWith("_before-update"))
        .map(e => e.name)
        .sort()
        .reverse();
      await Promise.all(dirs.slice(keep).map(name => fsp.rm(path.join(root, name), { recursive: true, force: true })));
      return;
    }

    const root = this.getMobileBackupRootRel();
    if (!(await this.adapterExists(root))) return;
    const listed = await this.adapterList(root);
    const dirs = (listed.folders || [])
      .filter(p => relBasename(p).endsWith("_before-update"))
      .sort()
      .reverse();
    for (const p of dirs.slice(keep)) await this.adapterRemove(p, true);
  }

  async prepareUpdate(info) {
    const { entry } = info;
    const source = this.sourceFor(entry);
    const [mainJs, remoteManifestText, cssResult] = await Promise.all([
      this.rawText(source.repo, source.branch, `${source.prefix}main.js`),
      this.rawText(source.repo, source.branch, `${source.prefix}manifest.json`),
      this.rawText(source.repo, source.branch, `${source.prefix}styles.css`)
        .then(text => ({ exists: true, text }))
        .catch(() => ({ exists: false, text: null }))
    ]);
    const remoteManifest = JSON.parse(remoteManifestText);
    if (remoteManifest.id !== entry.id) throw new Error(`ID не совпадает: registry=${entry.id}, manifest=${remoteManifest.id}`);
    return { ...info, remoteManifest, remoteManifestText, mainJs, stylesCss: cssResult.text, hasStyles: cssResult.exists };
  }

  async buildDesktopSyncPlan(checkout) {
    const { path } = this.node;
    const [{ registry }, projects, policy] = await Promise.all([
      this.readCheckoutRegistry(checkout),
      this.listDevProjects(),
      this.loadDesktopSyncPolicy()
    ]);
    const entries = new Map(registry.plugins.map(entry => [String(entry.id), entry]));
    const projectsById = new Map(projects.map(project => [project.id, project]));
    const items = [];

    for (const project of projects) {
      const blockedReason = policy?.blocked?.[project.id];
      if (blockedReason) {
        items.push({ project, entry: entries.get(project.id) || null, decision: "blocked", reason: String(blockedReason) });
        continue;
      }
      const entry = entries.get(project.id) || null;
      const devHash = await this.hashProject(project.dir);
      if (!entry) {
        items.push({ project, entry: null, devHash, githubHash: "", githubVersion: "0.0.0", decision: "dev-to-github", migration: true });
        continue;
      }

      const githubVersion = String(entry.version || "0.0.0");
      if (entry.sourceComplete === true && entry.sourcePath) {
        const sourceDir = path.join(checkout, ...String(entry.sourcePath).split("/"));
        const sourceManifestPath = path.join(sourceDir, "manifest.json");
        if (!(await this.desktopExists(sourceManifestPath))) {
          items.push({ project, entry, devHash, githubVersion, decision: "conflict", reason: "sourceComplete указан, но source/manifest.json отсутствует" });
          continue;
        }
        const sourceManifest = await this.readDesktopJson(sourceManifestPath);
        const githubHash = await this.hashProject(sourceDir);
        if (sourceManifest.id !== project.id || String(sourceManifest.version) !== githubVersion) {
          items.push({ project, entry, devHash, githubHash, githubVersion, decision: "conflict", reason: "manifest source не совпадает с registry" });
          continue;
        }
        if (entry.sourceHash && entry.sourceHash !== githubHash) {
          items.push({ project, entry, devHash, githubHash, githubVersion, decision: "conflict", reason: "sourceHash в registry не совпадает с GitHub" });
          continue;
        }
        items.push({ project, entry, devHash, githubHash, githubVersion, sourceDir, sourceManifest, decision: decideSync(project.version, githubVersion, devHash, githubHash) });
        continue;
      }

      // Safe first migration from the old runtime-only registry. A newer remote runtime
      // can never overwrite a full dev project. Equal versions migrate only when the
      // runtime artifacts are byte-for-byte identical.
      if (compareVersions(project.version, githubVersion) < 0) {
        items.push({ project, entry, devHash, githubVersion, decision: "blocked", reason: "GitHub новее, но полный source-снимок ещё не опубликован" });
        continue;
      }
      if (compareVersions(project.version, githubVersion) === 0) {
        const remoteDir = path.join(checkout, ...String(entry.path).split("/"));
        const runtimeFiles = Array.isArray(entry.runtimeFiles) ? entry.runtimeFiles : await this.existingRuntimeFiles(remoteDir);
        const [devRuntimeHash, githubRuntimeHash] = await Promise.all([
          this.hashRuntime(project.dir, runtimeFiles),
          this.hashRuntime(remoteDir, runtimeFiles)
        ]);
        if (devRuntimeHash !== githubRuntimeHash) {
          items.push({ project, entry, devHash, githubVersion, decision: "conflict", reason: "одинаковая версия runtime-only, но runtime-файлы различаются" });
          continue;
        }
      }
      items.push({ project, entry, devHash, githubVersion, githubHash: "", decision: "dev-to-github", migration: true });
    }

    for (const entry of registry.plugins) {
      const id = String(entry.id || "");
      if (!id || projectsById.has(id) || entry.sourceComplete !== true || !entry.sourcePath) continue;
      const blockedReason = policy?.blocked?.[id];
      if (blockedReason) {
        items.push({ project: null, entry, decision: "blocked", reason: String(blockedReason) });
        continue;
      }
      const sourceDir = path.join(checkout, ...String(entry.sourcePath).split("/"));
      if (!(await this.desktopExists(path.join(sourceDir, "manifest.json")))) continue;
      const sourceManifest = await this.readDesktopJson(path.join(sourceDir, "manifest.json"));
      const githubHash = await this.hashProject(sourceDir);
      if (entry.sourceHash && entry.sourceHash !== githubHash) {
        items.push({ project: null, entry, githubHash, decision: "conflict", reason: "sourceHash в registry не совпадает с GitHub" });
        continue;
      }
      items.push({
        project: { id, version: "0.0.0", manifest: { id, name: entry.name || id, version: "0.0.0" }, dir: path.join(this.getDevRoot(), id), folderName: id },
        entry,
        githubVersion: String(entry.version),
        githubHash,
        sourceDir,
        sourceManifest,
        decision: "github-to-dev",
        newDevProject: true
      });
    }
    return { registry, items };
  }

  async prepareIncomingProject(item) {
    const { fsp, path } = this.node;
    const incomingRoot = path.join(this.getDesktopSyncRoot(), "incoming");
    const stage = path.join(incomingRoot, `${item.entry.id}-${Date.now()}`);
    await fsp.mkdir(incomingRoot, { recursive: true });
    await this.copyProjectTree(item.sourceDir, stage);
    const existingModules = path.join(item.project.dir, "node_modules");
    const stageModules = path.join(stage, "node_modules");
    if (await this.desktopExists(existingModules)) {
      try { await fsp.symlink(existingModules, stageModules, "dir"); } catch {}
    }
    await this.runProjectChecks(stage);
    try { await fsp.rm(stageModules, { recursive: true, force: true }); } catch {}
    const manifest = await this.readDesktopJson(path.join(stage, "manifest.json"));
    const hash = await this.hashProject(stage);
    if (manifest.id !== item.entry.id || String(manifest.version) !== String(item.entry.version)) {
      throw new Error(`${item.entry.id}: входящий source содержит другую версию или ID.`);
    }
    if (item.entry.sourceHash && hash !== item.entry.sourceHash) {
      throw new Error(`${item.entry.id}: build изменил опубликованный source; применение отменено.`);
    }
    return { ...item, incomingDir: stage, incomingManifest: manifest, incomingHash: hash };
  }

  async applyIncomingProject(item) {
    const { fsp, path } = this.node;
    const target = item.project.dir;
    const parent = path.dirname(target);
    const name = path.basename(target);
    const next = path.join(parent, `.${name}.updater-next-${Date.now()}`);
    const old = path.join(this.getDesktopSyncRoot(), "replaced-dev", `${name}-${stamp()}`);
    await this.copyProjectTree(item.incomingDir, next);
    const oldModules = path.join(target, "node_modules");
    if (await this.desktopExists(oldModules)) {
      try { await fsp.rename(oldModules, path.join(next, "node_modules")); } catch {}
    }
    await fsp.mkdir(path.dirname(old), { recursive: true });
    if (await this.desktopExists(target)) await fsp.rename(target, old);
    try {
      await fsp.rename(next, target);
    } catch (error) {
      if (await this.desktopExists(old) && !(await this.desktopExists(target))) await fsp.rename(old, target);
      throw error;
    }
    return { ...item.project, dir: target, version: String(item.incomingManifest.version), manifest: item.incomingManifest };
  }

  async runtimeInfoFromDev(project, installed) {
    const { fsp, path } = this.node;
    const manifestText = await fsp.readFile(path.join(project.dir, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestText);
    const mainJs = await fsp.readFile(path.join(project.dir, "main.js"), "utf8");
    const stylesPath = path.join(project.dir, "styles.css");
    const hasStyles = await this.desktopExists(stylesPath);
    const stylesCss = hasStyles ? await fsp.readFile(stylesPath, "utf8") : null;
    const local = installed.get(manifest.id) || null;
    return {
      entry: { id: manifest.id, name: manifest.name || manifest.id, version: manifest.version },
      local,
      remoteManifest: manifest,
      remoteManifestText: manifestText,
      mainJs,
      stylesCss,
      hasStyles
    };
  }

  async updateRuntimeFromProjects(projects) {
    const installed = await this.readInstalledPlugins();
    let updated = 0;
    for (const project of projects) {
      const info = await this.runtimeInfoFromDev(project, installed);
      const ok = info.local ? await this.installPreparedPlugin(info) : await this.installNewPlugin(info);
      if (ok) updated++;
    }
    return updated;
  }

  async runtimeProjectNeedsUpdate(project, installed) {
    const { path } = this.node;
    const local = installed.get(project.id);
    if (!local || compareVersions(project.version, local.version) !== 0) return true;
    const devFiles = await this.existingRuntimeFiles(project.dir);
    const localDir = path.join(this.getDesktopVaultPath(), ...String(local.dir).split("/"));
    const localFiles = await this.existingRuntimeFiles(localDir).catch(() => []);
    if (devFiles.join("\0") !== localFiles.join("\0")) return true;
    const [devHash, localHash] = await Promise.all([
      this.hashRuntime(project.dir, devFiles),
      this.hashRuntime(localDir, localFiles)
    ]);
    return devHash !== localHash;
  }

  async iphoneMirrorIsCurrent(mainCheckout, branch) {
    try {
      const checkout = await this.ensureGitCheckout(MOBILE_REGISTRY_REPO, branch, "iphone");
      const [{ registry: main }, { registry: mobile }] = await Promise.all([
        this.readCheckoutRegistry(mainCheckout),
        this.readCheckoutRegistry(checkout)
      ]);
      const expected = [];
      for (const entry of main.plugins) {
        const manifestPath = this.node.path.join(mainCheckout, ...String(entry.path).split("/"), "manifest.json");
        if (!(await this.desktopExists(manifestPath))) continue;
        const manifest = await this.readDesktopJson(manifestPath);
        if (isMobileEligible(manifest)) expected.push([manifest.id, String(manifest.version), String(entry.runtimeHash || "")]);
      }
      const actual = mobile.plugins.map(entry => [String(entry.id), String(entry.version), String(entry.runtimeHash || "")]);
      expected.sort((a, b) => a[0].localeCompare(b[0], "en"));
      actual.sort((a, b) => a[0].localeCompare(b[0], "en"));
      return JSON.stringify(expected) === JSON.stringify(actual);
    } catch {
      return false;
    }
  }

  async rebuildIphoneMirror(mainCheckout, branch) {
    const { fsp, path } = this.node;
    const checkout = await this.ensureGitCheckout(MOBILE_REGISTRY_REPO, branch, "iphone");
    const { registry } = await this.readCheckoutRegistry(mainCheckout);
    for (const entry of await fsp.readdir(checkout, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      await fsp.rm(path.join(checkout, entry.name), { recursive: true, force: true });
    }
    const mobilePlugins = [];
    for (const entry of registry.plugins) {
      const sourceDir = path.join(mainCheckout, ...String(entry.path).split("/"));
      const manifestPath = path.join(sourceDir, "manifest.json");
      if (!(await this.desktopExists(manifestPath))) continue;
      const manifest = await this.readDesktopJson(manifestPath);
      if (!isMobileEligible(manifest)) continue;
      const destination = path.join(checkout, ...String(entry.path).split("/"));
      await fsp.mkdir(destination, { recursive: true });
      const runtimeFiles = Array.isArray(entry.runtimeFiles) ? entry.runtimeFiles : await this.existingRuntimeFiles(sourceDir);
      for (const name of runtimeFiles) await fsp.copyFile(path.join(sourceDir, name), path.join(destination, name));
      mobilePlugins.push({
        id: manifest.id,
        name: manifest.name || manifest.id,
        version: manifest.version,
        path: entry.path,
        runtimeHash: await this.hashRuntime(destination, runtimeFiles),
        runtimeFiles,
        mobile: true,
        isDesktopOnly: false
      });
    }
    mobilePlugins.sort((a, b) => a.id.localeCompare(b.id, "en"));
    await this.writeDesktopJsonAtomic(path.join(checkout, "registry.json"), { schemaVersion: 2, mirrorOf: MAIN_REGISTRY_REPO, plugins: mobilePlugins });
    await this.writeDesktopTextAtomic(path.join(checkout, "README.md"), "# Obsidian Plugins — iPhone\n\nАвтоматическое runtime-зеркало мобильных плагинов из `volnexx/obsidian-plugins`. Не является источником разработки.\n");
    const commit = await this.commitCheckout(checkout, "Sync iPhone plugin mirror");
    const sha = commit ? await this.pushAndVerify(checkout, branch) : await this.gitHead(checkout);
    return { count: mobilePlugins.length, sha, changed: !!commit };
  }

  formatDesktopSyncSummary(summary) {
    return `dev → GitHub: ${summary.devToGithub}\nGitHub → dev: ${summary.githubToDev}\nruntime обновлено: ${summary.runtime}\niPhone зеркало: ${summary.iphone}\nконфликтов: ${summary.conflicts}`;
  }

  async safeDesktopSynchronizeAll() {
    const branch = this.settings.registryBranch || "centralize-plugins";
    const checkout = await this.ensureGitCheckout(MAIN_REGISTRY_REPO, branch, "main");
    const plan = await this.buildDesktopSyncPlan(checkout);
    const conflicts = plan.items.filter(item => item.decision === "conflict");
    const blocked = plan.items.filter(item => item.decision === "blocked");
    for (const item of conflicts) {
      const id = item.project?.id || item.entry?.id;
      const version = item.project?.version || item.entry?.version;
      new Notice(`Конфликт ${item.project?.manifest?.name || item.entry?.name || id} ${version}: одинаковая версия, но dev и GitHub различаются. ${item.reason || ""}`, 12000);
    }
    for (const item of blocked) new Notice(`${item.project?.manifest?.name || item.entry?.name}: синхронизация пропущена — ${item.reason}.`, 10000);

    const actionable = plan.items.filter(item => item.decision === "dev-to-github" || item.decision === "github-to-dev");
    const synchronized = plan.items.filter(item => item.decision === "noop");
    const installedBefore = await this.readInstalledPlugins();
    const runtimeDrift = [];
    for (const item of synchronized) {
      if (item.project && await this.runtimeProjectNeedsUpdate(item.project, installedBefore)) runtimeDrift.push(item.project);
    }
    const mirrorDrift = !(await this.iphoneMirrorIsCurrent(checkout, branch));
    if (!actionable.length && !runtimeDrift.length && !mirrorDrift) {
      const summary = { devToGithub: 0, githubToDev: 0, runtime: 0, iphone: 0, conflicts: conflicts.length, mainSha: await this.gitHead(checkout), iphoneSha: "" };
      new Notice(this.formatDesktopSyncSummary(summary), 12000);
      return summary;
    }
    if (!(await this.assertUpdateUnlocked(true))) return null; // Race barrier before backup/build/write.
    const backup = await this.createVaultBackup();
    if (!backup) return null;
    if (!(await this.assertUpdateUnlocked(true))) return null; // Codex may start while the backup is running.

    const preparedOutgoing = [];
    const preparedIncoming = [];
    for (const item of actionable) {
      if (item.decision === "dev-to-github") {
        await this.runProjectChecks(item.project.dir);
        const manifest = await this.readDesktopJson(this.node.path.join(item.project.dir, "manifest.json"));
        preparedOutgoing.push({ ...item, project: { ...item.project, manifest, version: String(manifest.version) } });
      } else {
        preparedIncoming.push(await this.prepareIncomingProject(item));
      }
    }

    const { file: registryFile, registry } = await this.readCheckoutRegistry(checkout);
    let mainSha = await this.gitHead(checkout);
    if (preparedOutgoing.length) {
      registry.schemaVersion = 2;
      const registryById = new Map(registry.plugins.map(entry => [String(entry.id), entry]));
      for (const item of preparedOutgoing) {
        const nextEntry = await this.stageMainRepositoryPlugin(checkout, item.project, item.entry);
        registryById.set(item.project.id, nextEntry);
      }
      registry.plugins = Array.from(registryById.values()).sort((a, b) => String(a.id).localeCompare(String(b.id), "en"));
      await this.writeDesktopJsonAtomic(registryFile, registry);
      const commit = await this.commitCheckout(checkout, `Sync plugins: ${preparedOutgoing.map(item => item.project.id).join(", ")}`);
      if (commit) mainSha = await this.pushAndVerify(checkout, branch);
    }

    const appliedIncoming = [];
    for (const item of preparedIncoming) appliedIncoming.push(await this.applyIncomingProject(item));
    const finalProjects = new Map((await this.listDevProjects()).map(project => [project.id, project]));
    for (const project of appliedIncoming) finalProjects.set(project.id, project);
    const runtimeCandidates = [...preparedOutgoing.map(item => finalProjects.get(item.project.id)), ...appliedIncoming, ...runtimeDrift];
    for (const item of synchronized) runtimeCandidates.push(finalProjects.get(item.project.id));
    const uniqueRuntime = Array.from(new Map(runtimeCandidates.filter(Boolean).map(project => [project.id, project])).values());
    const runtime = await this.updateRuntimeFromProjects(uniqueRuntime);

    let iphone = 0;
    let iphoneSha = "";
    try {
      const mirror = await this.rebuildIphoneMirror(checkout, branch);
      iphone = mirror.changed ? mirror.count : 0;
      iphoneSha = mirror.sha;
    } catch (error) {
      console.error("[Updater Plugin] iPhone mirror failed:", error);
      new Notice(`iPhone-зеркало не обновлено: ${error.message}`, 12000);
    }

    const summary = {
      devToGithub: preparedOutgoing.length,
      githubToDev: preparedIncoming.length,
      runtime,
      iphone,
      conflicts: conflicts.length,
      mainSha,
      iphoneSha
    };
    new Notice(this.formatDesktopSyncSummary(summary), 15000);
    if (runtime > 0) setTimeout(() => {
      try { window.location.reload(); }
      catch { new Notice("Изменения записаны. Перезапусти Obsidian вручную один раз.", 10000); }
    }, 700);
    return summary;
  }

  async safeUpdateAll() {
    if (!(await this.assertUpdateUnlocked(true))) return;
    if (!this.isDesktopApp) return this.safeInstallAllFromRegistry();
    if (this._busy) {
      new Notice("Обновление уже выполняется.");
      return;
    }
    this._busy = true;
    try { return await this.safeDesktopSynchronizeAll(); }
    catch (error) {
      console.error("[Updater Plugin] desktop sync:", error);
      new Notice(`Ошибка синхронизации: ${error.message}`, 12000);
      return null;
    } finally {
      this._busy = false;
    }
  }

  async safeInstallAllFromRegistry() {
    if (this._busy) {
      new Notice("Обновление уже выполняется.");
      return;
    }
    this._busy = true;
    const started = Date.now();
    try {
      const discovered = await this.resolveRegistryPlugins();
      const updates = await this.findUpdates(discovered.installed);
      const pending = [...updates, ...discovered.missing.map(p => ({ ...p, updateReason: "new" }))];
      if (!pending.length) {
        new Notice(`В репозитории: ${discovered.all.length}; установлено: ${discovered.installed.length}; обновлений и новых плагинов нет.`);
        return;
      }

      if (discovered.ambiguous.length) new Notice(`Неоднозначных совпадений: ${discovered.ambiguous.length}. Они пропущены.`, 8000);
      new Notice(`Обновлений: ${updates.length}; новых плагинов: ${discovered.missing.length}. Загружаю файлы…`);

      const preparedResults = await Promise.all(pending.map(p => this.prepareUpdate(p)
        .then(value => ({ ok: true, value }))
        .catch(error => ({ ok: false, plugin: p, error }))));

      const failedDownloads = preparedResults.filter(x => !x.ok);
      for (const f of failedDownloads) {
        const name = f.plugin.local?.name || f.plugin.entry.name;
        new Notice(`${name}: ошибка загрузки — ${f.error.message}`, 8000);
      }

      const prepared = preparedResults.filter(x => x.ok).map(x => x.value);
      if (!prepared.length) {
        new Notice("Ни одно изменение не удалось подготовить.");
        return;
      }

      const backup = await this.createVaultBackup();
      if (!backup) return;

      const normal = prepared.filter(p => p.entry.id !== this.manifest.id);
      const selfUpdate = prepared.find(p => p.entry.id === this.manifest.id) || null;
      let updated = 0;
      let installed = 0;
      let failed = failedDownloads.length;

      for (const info of normal) {
        if (info.local) {
          if (await this.installPreparedPlugin(info)) updated++; else failed++;
        } else {
          if (await this.installNewPlugin(info)) installed++; else failed++;
        }
      }

      if (selfUpdate) {
        if (await this.installSelfUpdate(selfUpdate)) updated++; else failed++;
      }

      const changed = updated + installed;
      new Notice(`Готово за ${((Date.now() - started) / 1000).toFixed(1)} с. Обновлено: ${updated}; установлено: ${installed}; ошибок: ${failed}.` + (changed > 0 ? " Перезапускаю Obsidian…" : ""), 10000);
      if (changed > 0) setTimeout(() => {
        try { window.location.reload(); }
        catch (e) {
          console.error("[Updater Plugin] reload failed:", e);
          new Notice("Изменения записаны. Перезапусти Obsidian вручную один раз.", 10000);
        }
      }, 700);
    } catch (e) {
      console.error("[Updater Plugin]", e);
      new Notice(`Ошибка обновления: ${e.message}`, 10000);
    } finally {
      this._busy = false;
    }
  }

  async updateEnabledPluginId(oldPluginId, newPluginId) {
    if (!oldPluginId || !newPluginId || oldPluginId === newPluginId) return null;
    const file = this.getCommunityPluginsPathRel();
    if (!(await this.adapterExists(file))) return null;
    const original = await this.adapterReadText(file);
    let ids;
    try { ids = JSON.parse(original); } catch { return null; }
    if (!Array.isArray(ids) || !ids.includes(oldPluginId)) return { file, original, changed: false };
    const next = Array.from(new Set(ids.map(id => id === oldPluginId ? newPluginId : id)));
    await this.adapterWriteText(file, JSON.stringify(next, null, 2) + "\n");
    return { file, original, changed: true };
  }

  async addEnabledPluginId(pluginId, manifest) {
    if (Platform.isMobileApp && manifest?.isDesktopOnly) return { changed: false, skippedDesktopOnly: true };
    const file = this.getCommunityPluginsPathRel();
    const existed = await this.adapterExists(file);
    const original = existed ? await this.adapterReadText(file) : null;
    let ids = [];
    if (original !== null) {
      try { ids = JSON.parse(original); }
      catch { throw new Error("community-plugins.json содержит некорректный JSON."); }
    }
    if (!Array.isArray(ids)) throw new Error("community-plugins.json должен содержать список плагинов.");
    if (ids.includes(pluginId)) return { file, original, existed, changed: false };
    await this.adapterWriteText(file, JSON.stringify([...ids, pluginId], null, 2) + "\n");
    return { file, original, existed, changed: true };
  }

  async restoreEnabledPluginIds(state) {
    if (!state?.changed) return;
    if (state.existed) await this.adapterWriteText(state.file, state.original);
    else await this.adapterRemove(state.file, false);
  }

  async installNewPlugin(info) {
    const { entry, remoteManifest, remoteManifestText, mainJs, stylesCss, hasStyles } = info;
    const pluginId = String(remoteManifest.id || "").trim();
    const root = this.getPluginsRootRel();
    const pluginDir = relPath(root, pluginId);
    let tempDir = "";
    let installedDirCreated = false;
    let enabledState = null;

    try {
      if (!/^[a-z0-9][a-z0-9_-]*$/iu.test(pluginId)) throw new Error(`Недопустимый ID плагина: ${pluginId || "пусто"}`);
      if (relDirname(pluginDir) !== root) throw new Error("Путь установки выходит за пределы папки плагинов.");
      if (await this.adapterExists(pluginDir)) throw new Error(`Папка ${pluginId} уже существует, но установленный плагин в ней не распознан.`);

      await this.ensureAdapterDir(root);
      tempDir = relPath(root, `.${pluginId}-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await this.ensureAdapterDir(tempDir);
      await Promise.all([
        this.adapterWriteText(relPath(tempDir, "main.js"), mainJs),
        this.adapterWriteText(relPath(tempDir, "manifest.json"), remoteManifestText),
        ...(hasStyles ? [this.adapterWriteText(relPath(tempDir, "styles.css"), stylesCss)] : [])
      ]);

      const writtenManifest = JSON.parse(await this.adapterReadText(relPath(tempDir, "manifest.json")));
      if (writtenManifest.id !== pluginId || !(await this.adapterExists(relPath(tempDir, "main.js")))) throw new Error("Проверка скачанных файлов не пройдена.");

      await this.adapter.rename(tempDir, pluginDir);
      tempDir = "";
      installedDirCreated = true;
      enabledState = await this.addEnabledPluginId(pluginId, remoteManifest);
      await this.safeRefreshPluginManifestCache(pluginId, remoteManifest);

      const suffix = enabledState?.skippedDesktopOnly ? "; на телефоне не включён (desktop-only)" : "; включится после перезапуска";
      new Notice(`${entry.name}: установлен ${remoteManifest.version}${suffix}.`);
      return true;
    } catch (e) {
      console.error("[Updater Plugin] new plugin install failed:", pluginId, e);
      try { await this.restoreEnabledPluginIds(enabledState); } catch {}
      try {
        if (installedDirCreated) await this.adapterRemove(pluginDir, true);
        if (tempDir) await this.adapterRemove(tempDir, true);
      } catch {}
      new Notice(`${entry?.name || pluginId}: установка не удалась — ${e.message}`, 10000);
      return false;
    }
  }

  async installPreparedPlugin(info) {
    const { local, remoteManifest, remoteManifestText, mainJs, stylesCss, hasStyles } = info;
    const pluginDir = local.dir;
    const oldPluginId = local.id;
    const newPluginId = remoteManifest.id || oldPluginId;
    const idChanged = oldPluginId !== newPluginId;
    const rollback = relPath(this.getUpdaterDirRel(), "rollback", oldPluginId, `${local.version}_${stamp()}`);
    let enabledIdState = null;

    try {
      await this.ensureAdapterDir(rollback);
      for (const name of ["main.js", "manifest.json", "styles.css"]) {
        const src = relPath(pluginDir, name);
        if (await this.adapterExists(src)) await this.adapterCopyFile(src, relPath(rollback, name));
      }
      if (idChanged) enabledIdState = await this.updateEnabledPluginId(oldPluginId, newPluginId);

      try {
        await Promise.all([
          this.adapterWriteText(relPath(pluginDir, "main.js"), mainJs),
          this.adapterWriteText(relPath(pluginDir, "manifest.json"), remoteManifestText),
          ...(hasStyles ? [this.adapterWriteText(relPath(pluginDir, "styles.css"), stylesCss)] : [])
        ]);
        if (!hasStyles && await this.adapterExists(relPath(pluginDir, "styles.css"))) await this.adapterRemove(relPath(pluginDir, "styles.css"), false);
        const migrationSuffix = idChanged ? `; id: ${oldPluginId} → ${newPluginId}` : "";
        new Notice(`${local.name}: ${local.version} → ${remoteManifest.version}${migrationSuffix}`);
        return true;
      } catch (e) {
        for (const name of ["main.js", "manifest.json", "styles.css"]) {
          const old = relPath(rollback, name);
          const cur = relPath(pluginDir, name);
          if (await this.adapterExists(old)) await this.adapterCopyFile(old, cur);
          else if (await this.adapterExists(cur)) await this.adapterRemove(cur, false);
        }
        if (enabledIdState?.changed) await this.adapterWriteText(enabledIdState.file, enabledIdState.original);
        throw new Error(`Старая версия возвращена: ${e.message}`);
      }
    } catch (e) {
      console.error("[Updater Plugin] install failed:", oldPluginId, e);
      new Notice(`${local.name}: ${e.message}`, 10000);
      return false;
    }
  }

  async installSelfUpdate(info) {
    const { local, remoteManifest, remoteManifestText, mainJs, stylesCss, hasStyles } = info;
    const pluginDir = local.dir;
    const rollback = relPath(pluginDir, "self-rollback", `${local.version}_${stamp()}`);
    try {
      await this.ensureAdapterDir(rollback);
      for (const name of ["main.js", "manifest.json", "styles.css"]) {
        const src = relPath(pluginDir, name);
        if (await this.adapterExists(src)) await this.adapterCopyFile(src, relPath(rollback, name));
      }

      await Promise.all([
        this.adapterWriteText(relPath(pluginDir, "main.js"), mainJs),
        this.adapterWriteText(relPath(pluginDir, "manifest.json"), remoteManifestText),
        ...(hasStyles ? [this.adapterWriteText(relPath(pluginDir, "styles.css"), stylesCss)] : [])
      ]);
      if (!hasStyles && await this.adapterExists(relPath(pluginDir, "styles.css"))) await this.adapterRemove(relPath(pluginDir, "styles.css"), false);
      new Notice(`Updater Plugin: ${local.version} → ${remoteManifest.version}. Применится после перезапуска.`);
      return true;
    } catch (e) {
      console.error("[Updater Plugin] self-update failed:", e);
      try {
        for (const name of ["main.js", "manifest.json", "styles.css"]) {
          const old = relPath(rollback, name);
          const cur = relPath(pluginDir, name);
          if (await this.adapterExists(old)) await this.adapterCopyFile(old, cur);
          else if (await this.adapterExists(cur)) await this.adapterRemove(cur, false);
        }
      } catch (rollbackError) {
        console.error("[Updater Plugin] self rollback failed:", rollbackError);
      }
      new Notice(`Самообновление Updater Plugin не удалось: ${e.message}`, 10000);
      return false;
    }
  }

  async safeRefreshPluginManifestCache(pluginId, manifest) {
    try { await this.refreshPluginManifestCache(pluginId, manifest); }
    catch (e) { console.warn("[Updater Plugin] manifest cache refresh error:", e); }
  }

  async refreshPluginManifestCache(pluginId, manifest) {
    const api = this.app.plugins;
    try { if (typeof api?.loadManifests === "function") await api.loadManifests(); }
    catch (e) { console.warn("[Updater Plugin] loadManifests failed:", e); }
    try {
      if (api?.manifests) api.manifests[pluginId] = manifest;
      const loaded = api?.plugins?.[pluginId];
      if (loaded && manifest) loaded.manifest = manifest;
    } catch (e) { console.warn("[Updater Plugin] manifest cache failed:", e); }
  }

  getRestoreStatePath() {
    if (this.isDesktopApp) return this.node.path.join(this.getDesktopBackupRoot(), "_updater-restore-state.json");
    return relPath(this.getMobileBackupRootRel(), "_updater-restore-state.json");
  }

  async readRestoreState() {
    try {
      const p = this.getRestoreStatePath();
      if (this.isDesktopApp) {
        if (!(await this.desktopExists(p))) return { mode: "back", forwardPath: "" };
        const state = JSON.parse(await this.node.fsp.readFile(p, "utf8"));
        if (state?.mode === "redo" && state.forwardPath && await this.desktopExists(state.forwardPath)) return state;
      } else {
        if (!(await this.adapterExists(p))) return { mode: "back", forwardPath: "" };
        const state = JSON.parse(await this.adapterReadText(p));
        if (state?.mode === "redo" && state.forwardPath && await this.adapterExists(state.forwardPath)) return state;
      }
    } catch (e) {
      console.warn("[Updater Plugin] restore state:", e);
    }
    return { mode: "back", forwardPath: "" };
  }

  async writeRestoreState(state) {
    const p = this.getRestoreStatePath();
    if (this.isDesktopApp) {
      await this.node.fsp.mkdir(this.getDesktopBackupRoot(), { recursive: true });
      await this.node.fsp.writeFile(p, JSON.stringify(state, null, 2), "utf8");
    } else {
      await this.adapterWriteText(p, JSON.stringify(state, null, 2));
    }
  }

  async listUpdateBackups() {
    if (this.isDesktopApp) {
      const root = this.getDesktopBackupRoot();
      if (!(await this.desktopExists(root))) return [];
      return (await this.node.fsp.readdir(root, { withFileTypes: true }))
        .filter(e => e.isDirectory() && e.name.endsWith("_before-update"))
        .map(e => this.node.path.join(root, e.name))
        .sort()
        .reverse();
    }
    const root = this.getMobileBackupRootRel();
    if (!(await this.adapterExists(root))) return [];
    const listed = await this.adapterList(root);
    return (listed.folders || []).filter(p => relBasename(p).endsWith("_before-update")).sort().reverse();
  }

  async createRestoreSnapshot() {
    if (this.isDesktopApp) return (await this.createDesktopVaultBackup("_before-rollback-forward")).path;
    return (await this.createMobileVaultBackup("_before-rollback-forward")).path;
  }

  async restoreDesktopSnapshot(snapshot) {
    const vault = this.getDesktopVaultPath();
    const updaterRel = this.getUpdaterDirRel();
    const configRel = this.getConfigDirRel();
    if (!(await this.desktopExists(this.node.path.join(snapshot, configRel)))) throw new Error("Некорректная резервная копия.");
    if (Platform.isLinux) {
      try {
        await this.runDesktopCommand("rsync", ["-a", "--delete", `--exclude=${updaterRel}/`, `${snapshot}/`, `${vault}/`]);
        return;
      } catch (e) {
        console.warn("[Updater Plugin] rsync restore fallback:", e);
      }
    }
    await this.node.fsp.cp(snapshot, vault, { recursive: true, force: true });
  }

  async restoreVaultFromSnapshot(snapshot) {
    if (this.isDesktopApp) return this.restoreDesktopSnapshot(snapshot);
    if (!(await this.adapterExists(relPath(snapshot, this.getConfigDirRel())))) throw new Error("Некорректная мобильная резервная копия.");
    await this.mirrorSnapshotToVault(snapshot, "");
  }

  async refreshRestoreActions() {
    if (!this.app.workspace?.getLeavesOfType) return;
    const state = await this.readRestoreState();
    const redo = state.mode === "redo";
    const icon = redo ? "redo-2" : "undo-2";
    const title = redo ? "Вернуть хранилище вперёд" : "Откатить хранилище назад";
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf?.view;
      if (!view || typeof view.addAction !== "function") continue;
      let el = this._restoreActionsByView.get(view);
      if (!el || !el.isConnected) {
        el = view.addAction(icon, title, () => { void this.handleRestoreAction(); });
        if (!el) continue;
        this._restoreActionsByView.set(view, el);
        this._restoreActionElements.add(el);
      }
      try { setIcon?.(el, icon); el.setAttribute("aria-label", title); } catch {}
    }
  }

  async handleRestoreAction() {
    if (this._restoreBusy) return;
    this._restoreBusy = true;
    try {
      const state = await this.readRestoreState();
      if (state.mode === "redo" && state.forwardPath) {
        await this.restoreVaultFromSnapshot(state.forwardPath);
        if (this.isDesktopApp) {
          try { await this.node.fsp.rm(state.forwardPath, { recursive: true, force: true }); } catch {}
          try { await this.node.fsp.rm(this.getRestoreStatePath(), { force: true }); } catch {}
        } else {
          try { await this.adapterRemove(state.forwardPath, true); } catch {}
          try { await this.adapterRemove(this.getRestoreStatePath(), false); } catch {}
        }
      } else {
        const backups = await this.listUpdateBackups();
        if (!backups.length) {
          new Notice("Нет резервной копии для отката.");
          return;
        }
        const forward = await this.createRestoreSnapshot();
        await this.writeRestoreState({ mode: "redo", forwardPath: forward, createdAt: new Date().toISOString() });
        await this.restoreVaultFromSnapshot(backups[0]);
      }
      new Notice("Хранилище восстановлено. Перезагружаю Obsidian…");
      setTimeout(() => { try { window.location.reload(); } catch {} }, 500);
    } catch (e) {
      console.error(e);
      new Notice(`Ошибка отката: ${e.message}`, 10000);
    } finally {
      this._restoreBusy = false;
    }
  }
};

module.exports.__test = {
  compareVersions,
  codexLockHeartbeatMs,
  codexLockIsFresh,
  codexLockTargetsDev,
  decideSync,
  isExcludedProjectPath,
  isMobileEligible,
  pcOnlyPluginIds: Array.from(PC_ONLY_PLUGIN_IDS).sort()
};
