const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, FileSystemAdapter, setIcon } = require("obsidian");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_SETTINGS = {
  registryRepo: "volnexx/obsidian-plugins",
  registryBranch: "centralize-plugins",
  registryPath: "registry.json",
  backupRoot: "",
  keepBackups: 10,
  fastBackup: true
};

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map(x => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map(x => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", d => stderr += String(d));
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${command}: ${stderr.trim()}`)));
  });
}

async function copyDirFallback(src, dst) {
  if (fsp.cp) {
    await fsp.cp(src, dst, { recursive: true, force: true, errorOnExist: false });
    return;
  }
  await fsp.mkdir(dst, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDirFallback(s, d);
    else await fsp.copyFile(s, d, fs.constants.COPYFILE_FICLONE);
  }
}

class UpdaterSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Updater Plugin" });

    new Setting(containerEl)
      .setName("Центральный репозиторий")
      .setDesc("Репозиторий с registry.json.")
      .addText(t => t
        .setValue(this.plugin.settings.registryRepo)
        .onChange(async v => {
          this.plugin.settings.registryRepo = v.trim() || "volnexx/obsidian-plugins";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Ветка реестра")
      .addText(t => t
        .setValue(this.plugin.settings.registryBranch)
        .onChange(async v => {
          this.plugin.settings.registryBranch = v.trim() || "main";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Путь к реестру")
      .addText(t => t
        .setValue(this.plugin.settings.registryPath)
        .onChange(async v => {
          this.plugin.settings.registryPath = v.trim() || "registry.json";
          await this.plugin.saveSettings();
        }));

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
      .setDesc("Один реестр → одна резервная копия → обновление всех найденных наших плагинов.")
      .addButton(b => b
        .setButtonText("Обновить всё")
        .setCta()
        .onClick(() => this.plugin.safeUpdateAll()));

    new Setting(containerEl)
      .setName("Проверить обновления")
      .addButton(b => b
        .setButtonText("Проверить")
        .onClick(() => this.plugin.checkOnly()));
  }
}

module.exports = class UpdaterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this._restoreActionElements = new Set();
    this._restoreActionsByView = new WeakMap();

    this.app.workspace.onLayoutReady(() => {
      void this.refreshRestoreActions();
    });

    this.registerEvent(this.app.workspace.on("layout-change", () => {
      void this.refreshRestoreActions();
    }));

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      void this.refreshRestoreActions();
    }));

    this.addRibbonIcon("refresh-cw", "Обновить все наши плагины", () => this.safeUpdateAll());

    this.addCommand({
      id: "safe-update-all-custom-plugins",
      name: "Обновить все наши плагины безопасно",
      callback: () => this.safeUpdateAll()
    });

    this.addCommand({
      id: "check-all-custom-plugin-updates",
      name: "Проверить обновления всех наших плагинов",
      callback: () => this.checkOnly()
    });

    this.addSettingTab(new UpdaterSettingTab(this.app, this));
  }

  onunload() {
    for (const el of this._restoreActionElements || []) {
      try { el.remove(); } catch {}
    }
    this._restoreActionElements?.clear();
  }

  getRestoreStatePath() {
    return path.join(this.getBackupRoot(), "_updater-restore-state.json");
  }

  async readRestoreState() {
    try {
      const p = this.getRestoreStatePath();
      if (!(await exists(p))) return { mode: "back", forwardPath: "" };
      const state = JSON.parse(await fsp.readFile(p, "utf8"));
      if (state?.mode === "redo" && typeof state.forwardPath === "string" && state.forwardPath) {
        if (await exists(state.forwardPath)) return state;
      }
    } catch (e) {
      console.warn("[Updater Plugin] restore state read failed:", e);
    }
    return { mode: "back", forwardPath: "" };
  }

  async writeRestoreState(state) {
    const root = this.getBackupRoot();
    await fsp.mkdir(root, { recursive: true });
    await fsp.writeFile(this.getRestoreStatePath(), JSON.stringify(state, null, 2), "utf8");
  }

  async clearRestoreState() {
    try { await fsp.rm(this.getRestoreStatePath(), { force: true }); } catch {}
  }

  async refreshRestoreActions() {
    const state = await this.readRestoreState();
    const isRedo = state.mode === "redo";
    const icon = isRedo ? "redo-2" : "undo-2";
    const title = isRedo ? "Вернуть хранилище вперёд" : "Откатить хранилище к последней резервной копии";
    const leaves = this.app.workspace.getLeavesOfType("markdown");

    for (const leaf of leaves) {
      const view = leaf?.view;
      if (!view || typeof view.addAction !== "function") continue;
      let el = this._restoreActionsByView.get(view);
      if (!el || !el.isConnected) {
        el = view.addAction(icon, title, () => { void this.handleRestoreAction(); });
        if (!el) continue;
        el.addClass?.("updater-plugin-vault-restore-action");
        this._restoreActionsByView.set(view, el);
        this._restoreActionElements.add(el);
      }
      try {
        setIcon(el, icon);
        el.setAttribute("aria-label", title);
        el.setAttribute("data-tooltip-position", "bottom");
      } catch {}
    }
  }

  async listUpdateBackups() {
    const root = this.getBackupRoot();
    if (!(await exists(root))) return [];
    const dirs = await fsp.readdir(root, { withFileTypes: true });
    return dirs.filter(e => e.isDirectory() && e.name.endsWith("_before-update"))
      .map(e => path.join(root, e.name)).sort().reverse();
  }

  async createSnapshotForRestore(tag) {
    const vault = this.getVaultPath();
    const root = this.getBackupRoot();
    await fsp.mkdir(root, { recursive: true });
    const dst = path.join(root, `${stamp()}_${tag}`);
    let method = "обычное копирование";

    if (this.settings.fastBackup && process.platform === "linux") {
      try {
        await fsp.mkdir(dst, { recursive: true });
        await runCommand("cp", ["-a", "--reflink=auto", `${vault}/.`, dst]);
        method = "reflink/cp";
      } catch (e) {
        console.warn("[Updater Plugin] fast restore snapshot failed:", e);
        await fsp.rm(dst, { recursive: true, force: true });
        await copyDirFallback(vault, dst);
      }
    } else {
      await copyDirFallback(vault, dst);
    }

    if (!(await exists(path.join(dst, ".obsidian")))) throw new Error("Снимок перед откатом повреждён: отсутствует .obsidian.");
    await fsp.writeFile(path.join(dst, "_updater-plugin-restore-snapshot.json"), JSON.stringify({
      createdAt: new Date().toISOString(), sourceVault: vault, updaterVersion: this.manifest.version, method
    }, null, 2), "utf8");
    return dst;
  }

  shouldPreserveRestorePath(rel) {
    const normalized = rel.split(path.sep).join("/");
    return normalized === ".obsidian/plugins/updater-plugin"
      || normalized.startsWith(".obsidian/plugins/updater-plugin/")
      || normalized === "_updater-plugin-backup.json"
      || normalized === "_updater-plugin-restore-snapshot.json";
  }

  async restoreDirectoryExactFallback(srcRoot, dstRoot, rel = "") {
    const src = rel ? path.join(srcRoot, rel) : srcRoot;
    const dst = rel ? path.join(dstRoot, rel) : dstRoot;
    if (this.shouldPreserveRestorePath(rel)) return;
    await fsp.mkdir(dst, { recursive: true });

    const srcEntries = new Map();
    for (const e of await fsp.readdir(src, { withFileTypes: true })) srcEntries.set(e.name, e);
    let dstEntries = [];
    try { dstEntries = await fsp.readdir(dst, { withFileTypes: true }); } catch {}

    for (const e of dstEntries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      if (this.shouldPreserveRestorePath(childRel)) continue;
      if (!srcEntries.has(e.name)) await fsp.rm(path.join(dst, e.name), { recursive: true, force: true });
    }

    for (const [name, e] of srcEntries) {
      const childRel = rel ? path.join(rel, name) : name;
      if (this.shouldPreserveRestorePath(childRel)) continue;
      const srcPath = path.join(src, name);
      const dstPath = path.join(dst, name);
      if (e.isDirectory()) {
        let dstStat = null;
        try { dstStat = await fsp.stat(dstPath); } catch {}
        if (dstStat && !dstStat.isDirectory()) await fsp.rm(dstPath, { recursive: true, force: true });
        await this.restoreDirectoryExactFallback(srcRoot, dstRoot, childRel);
      } else {
        let dstStat = null;
        try { dstStat = await fsp.stat(dstPath); } catch {}
        if (dstStat?.isDirectory()) await fsp.rm(dstPath, { recursive: true, force: true });
        await fsp.mkdir(path.dirname(dstPath), { recursive: true });
        await fsp.copyFile(srcPath, dstPath);
      }
    }
  }

  async restoreVaultFromSnapshot(snapshotPath) {
    const vault = this.getVaultPath();
    if (!(await exists(snapshotPath))) throw new Error("Резервная копия больше не существует.");
    if (!(await exists(path.join(snapshotPath, ".obsidian")))) throw new Error("В выбранной резервной копии отсутствует .obsidian.");

    if (process.platform === "linux") {
      try {
        await runCommand("rsync", ["-a", "--delete", "--exclude=.obsidian/plugins/updater-plugin/", "--exclude=_updater-plugin-backup.json", "--exclude=_updater-plugin-restore-snapshot.json", `${snapshotPath}/`, `${vault}/`]);
        return "rsync";
      } catch (e) {
        console.warn("[Updater Plugin] rsync restore unavailable, fallback:", e);
      }
    }
    await this.restoreDirectoryExactFallback(snapshotPath, vault);
    return "JavaScript";
  }

  reloadObsidianAfterRestore() {
    new Notice("Хранилище восстановлено. Перезагружаю Obsidian…", 5000);
    setTimeout(() => {
      try { window.location.reload(); }
      catch (e) {
        console.error("[Updater Plugin] reload failed:", e);
        new Notice("Перезапусти Obsidian вручную, чтобы полностью применить восстановленное состояние.", 10000);
      }
    }, 500);
  }

  async handleRestoreAction() {
    if (this._restoreBusy) { new Notice("Восстановление уже выполняется."); return; }
    this._restoreBusy = true;
    try {
      const state = await this.readRestoreState();
      if (state.mode === "redo" && state.forwardPath) {
        new Notice("Возвращаю хранилище вперёд…");
        await this.restoreVaultFromSnapshot(state.forwardPath);
        try { await fsp.rm(state.forwardPath, { recursive: true, force: true }); } catch {}
        await this.clearRestoreState();
        await this.refreshRestoreActions();
        this.reloadObsidianAfterRestore();
        return;
      }

      const backups = await this.listUpdateBackups();
      if (!backups.length) { new Notice("Нет резервной копии, к которой можно откатить хранилище.", 8000); return; }
      const target = backups[0];

      new Notice("Сохраняю текущее состояние для возврата вперёд…");
      const forwardPath = await this.createSnapshotForRestore("before-rollback-forward");
      await this.writeRestoreState({ mode: "redo", forwardPath, rollbackSource: target, createdAt: new Date().toISOString() });

      new Notice("Откатываю хранилище к последней резервной копии…");
      try {
        await this.restoreVaultFromSnapshot(target);
      } catch (restoreError) {
        new Notice("Откат не удался. Возвращаю исходное состояние…", 8000);
        try {
          await this.restoreVaultFromSnapshot(forwardPath);
          await this.clearRestoreState();
          await fsp.rm(forwardPath, { recursive: true, force: true });
        } catch (recoveryError) {
          console.error("[Updater Plugin] emergency restore failed:", recoveryError);
        }
        throw restoreError;
      }

      await this.refreshRestoreActions();
      this.reloadObsidianAfterRestore();
    } catch (e) {
      console.error("[Updater Plugin] vault restore failed:", e);
      new Notice(`Ошибка восстановления: ${e.message}`, 12000);
    } finally {
      this._restoreBusy = false;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getVaultPath() {
    const a = this.app.vault.adapter;
    if (!(a instanceof FileSystemAdapter) || typeof a.getBasePath !== "function") {
      throw new Error("Updater Plugin работает только в настольном Obsidian.");
    }
    return a.getBasePath();
  }

  getPluginsRoot() {
    return path.join(this.getVaultPath(), ".obsidian", "plugins");
  }

  getBackupRoot() {
    const vault = this.getVaultPath();
    return this.settings.backupRoot
      ? path.resolve(this.settings.backupRoot)
      : path.join(path.dirname(vault), `${path.basename(vault)}-backups`);
  }

  async rawText(repo, branch, file) {
    const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${file}`;
    const r = await requestUrl({ url, method: "GET" });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`${repo}/${file}: HTTP ${r.status}`);
    }
    return r.text;
  }

  async fetchRegistry() {
    const started = Date.now();

    const text = await this.rawText(
      this.settings.registryRepo,
      this.settings.registryBranch,
      this.settings.registryPath
    );

    let registry;
    try {
      registry = JSON.parse(text);
    } catch {
      throw new Error("registry.json содержит некорректный JSON.");
    }

    if (registry?.schemaVersion !== 1 || !Array.isArray(registry.plugins)) {
      throw new Error("Неподдерживаемый формат registry.json.");
    }

    const ms = Date.now() - started;
    new Notice(`Реестр загружен за ${(ms / 1000).toFixed(2)} с. Плагинов: ${registry.plugins.length}.`);
    return registry;
  }

  async readInstalledPlugins() {
    const root = this.getPluginsRoot();
    const result = new Map();

    if (!(await exists(root))) return result;

    const dirs = (await fsp.readdir(root, { withFileTypes: true }))
      .filter(e => e.isDirectory());

    await Promise.all(dirs.map(async e => {
      const manifestPath = path.join(root, e.name, "manifest.json");
      if (!(await exists(manifestPath))) return;

      try {
        const m = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
        if (m?.id) {
          result.set(m.id, {
            id: m.id,
            name: m.name || m.id,
            version: m.version || "0.0.0",
            dir: path.join(root, e.name),
            manifest: m
          });
        }
      } catch {}
    }));

    return result;
  }

  async resolveRegistryPlugins() {
    const [registry, installed] = await Promise.all([
      this.fetchRegistry(),
      this.readInstalledPlugins()
    ]);

    const found = [];

    for (const entry of registry.plugins) {
      if (!entry?.id || !entry?.version) continue;
      const local = installed.get(entry.id);
      if (!local) continue;

      found.push({
        entry,
        local
      });
    }

    return found;
  }

  async checkOnly() {
    if (this._busy) {
      new Notice("Операция уже выполняется.");
      return;
    }

    this._busy = true;
    try {
      const plugins = await this.resolveRegistryPlugins();
      const updates = plugins.filter(p =>
        compareVersions(p.entry.version, p.local.version) > 0
      );

      if (!updates.length) {
        new Notice(`Наших установленных плагинов найдено: ${plugins.length}. Обновлений нет.`);
        return;
      }

      new Notice(
        `Обновлений: ${updates.length}. ` +
        updates.map(p => `${p.local.name} ${p.local.version} → ${p.entry.version}`).join("; "),
        12000
      );
    } catch (e) {
      console.error("[Updater Plugin]", e);
      new Notice(`Ошибка проверки: ${e.message}`, 10000);
    } finally {
      this._busy = false;
    }
  }

  async createVaultBackup() {
    const started = Date.now();

    try {
      const vault = this.getVaultPath();
      const root = this.getBackupRoot();
      await fsp.mkdir(root, { recursive: true });

      const dst = path.join(root, `${stamp()}_before-update`);
      new Notice("Создаю резервную копию…");

      let method = "обычное копирование";

      if (this.settings.fastBackup && process.platform === "linux") {
        try {
          await fsp.mkdir(dst, { recursive: true });
          await runCommand("cp", ["-a", "--reflink=auto", `${vault}/.`, dst]);
          method = "reflink/cp";
        } catch {
          await fsp.rm(dst, { recursive: true, force: true });
          await copyDirFallback(vault, dst);
        }
      } else {
        await copyDirFallback(vault, dst);
      }

      await fsp.writeFile(
        path.join(dst, "_updater-plugin-backup.json"),
        JSON.stringify({
          createdAt: new Date().toISOString(),
          sourceVault: vault,
          updaterVersion: this.manifest.version,
          method
        }, null, 2),
        "utf8"
      );

      if (!(await exists(path.join(dst, ".obsidian")))) {
        throw new Error("Проверка резервной копии не пройдена: нет .obsidian.");
      }

      await this.pruneBackups(root);

      new Notice(`Копия готова за ${((Date.now() - started) / 1000).toFixed(1)} с (${method}).`);
      return dst;
    } catch (e) {
      console.error("[Updater Plugin] backup failed:", e);
      new Notice(`Копия не создана. Обновление отменено: ${e.message}`, 10000);
      return null;
    }
  }

  async pruneBackups(root) {
    const dirs = (await fsp.readdir(root, { withFileTypes: true }))
      .filter(e => e.isDirectory() && e.name.endsWith("_before-update"))
      .map(e => e.name)
      .sort()
      .reverse();

    const keep = Math.max(1, this.settings.keepBackups || 10);

    await Promise.all(
      dirs.slice(keep).map(name =>
        fsp.rm(path.join(root, name), { recursive: true, force: true })
      )
    );
  }

  sourceFor(entry) {
    if (entry.sourceRepo) {
      return {
        repo: entry.sourceRepo,
        branch: entry.sourceBranch || "main",
        prefix: ""
      };
    }

    return {
      repo: this.settings.registryRepo,
      branch: this.settings.registryBranch,
      prefix: entry.path ? `${entry.path.replace(/\/+$/u, "")}/` : ""
    };
  }

  async prepareUpdate(info) {
    const { entry } = info;
    const source = this.sourceFor(entry);

    const mainPath = `${source.prefix}main.js`;
    const manifestPath = `${source.prefix}manifest.json`;
    const stylesPath = `${source.prefix}styles.css`;

    const [mainJs, remoteManifestText, cssResult] = await Promise.all([
      this.rawText(source.repo, source.branch, mainPath),
      this.rawText(source.repo, source.branch, manifestPath),
      this.rawText(source.repo, source.branch, stylesPath)
        .then(text => ({ exists: true, text }))
        .catch(() => ({ exists: false, text: null }))
    ]);

    const remoteManifest = JSON.parse(remoteManifestText);

    if (remoteManifest.id !== entry.id) {
      throw new Error(`ID не совпадает: registry=${entry.id}, manifest=${remoteManifest.id}`);
    }

    return {
      ...info,
      remoteManifest,
      remoteManifestText,
      mainJs,
      stylesCss: cssResult.text,
      hasStyles: cssResult.exists
    };
  }

  async safeUpdateAll() {
  if (this._busy) {
    new Notice("Обновление уже выполняется.");
    return;
  }

  this._busy = true;
  const started = Date.now();

  try {
    const plugins = await this.resolveRegistryPlugins();

    if (!plugins.length) {
      new Notice("Ни один установленный наш плагин не найден в центральном реестре.");
      return;
    }

    const updates = plugins.filter(p =>
      compareVersions(p.entry.version, p.local.version) > 0
    );

    if (!updates.length) {
      new Notice(`Проверено ${plugins.length}. Обновлений нет.`);
      return;
    }

    new Notice(`Найдено обновлений: ${updates.length}. Загружаю файлы…`);

    const preparedResults = await Promise.all(
      updates.map(p =>
        this.prepareUpdate(p)
          .then(value => ({ ok: true, value }))
          .catch(error => ({ ok: false, plugin: p, error }))
      )
    );

    const failedDownloads = preparedResults.filter(x => !x.ok);
    for (const f of failedDownloads) {
      new Notice(`${f.plugin.local.name}: ошибка загрузки — ${f.error.message}`, 8000);
    }

    const prepared = preparedResults.filter(x => x.ok).map(x => x.value);
    if (!prepared.length) {
      new Notice("Ни одно обновление не удалось подготовить.");
      return;
    }

    const backup = await this.createVaultBackup();
    if (!backup) return;

    const normalUpdates = prepared.filter(p => p.local.id !== this.manifest.id);
    const selfUpdate = prepared.find(p => p.local.id === this.manifest.id) || null;

    let updated = 0;
    let failed = failedDownloads.length;

    for (const info of normalUpdates) {
      if (await this.installPreparedPlugin(info)) updated++;
      else failed++;
    }

    if (selfUpdate) {
      if (await this.installSelfUpdate(selfUpdate)) updated++;
      else failed++;
    }

    new Notice(
      `Готово за ${((Date.now() - started) / 1000).toFixed(1)} с. Обновлено: ${updated}; ошибок: ${failed}.`,
      10000
    );
  } catch (e) {
    console.error("[Updater Plugin]", e);
    new Notice(`Ошибка обновления: ${e.message}`, 10000);
  } finally {
    this._busy = false;
  }
}

async installSelfUpdate(info) {
  const { local, remoteManifest, remoteManifestText, mainJs, stylesCss, hasStyles } = info;
  const pluginId = this.manifest.id;
  const pluginDir = local.dir;
  const rollback = path.join(pluginDir, "self-rollback", `${local.version}_${stamp()}`);

  try {
    await fsp.mkdir(rollback, { recursive: true });

    await Promise.all(["main.js", "manifest.json", "styles.css"].map(async name => {
      const src = path.join(pluginDir, name);
      if (await exists(src)) await fsp.copyFile(src, path.join(rollback, name));
    }));

    const writes = [
      fsp.writeFile(path.join(pluginDir, "main.js"), mainJs, "utf8"),
      fsp.writeFile(path.join(pluginDir, "manifest.json"), remoteManifestText, "utf8")
    ];
    if (hasStyles) writes.push(fsp.writeFile(path.join(pluginDir, "styles.css"), stylesCss, "utf8"));
    await Promise.all(writes);

    if (!hasStyles) {
      const css = path.join(pluginDir, "styles.css");
      if (await exists(css)) await fsp.rm(css, { force: true });
    }

    await this.refreshPluginManifestCache(pluginId, remoteManifest);

    new Notice(`Updater Plugin: ${local.version} → ${remoteManifest.version}. Перезапускаю себя…`);

    const api = this.app.plugins;
    setTimeout(async () => {
      try {
        if (api?.disablePlugin) await api.disablePlugin(pluginId);
        if (api?.enablePlugin) await api.enablePlugin(pluginId);
        new Notice(`Updater Plugin ${remoteManifest.version} запущен.`);
      } catch (restartError) {
        console.error("[Updater Plugin] self restart failed:", restartError);
        new Notice(`Updater Plugin обновлён до ${remoteManifest.version}, но автоматический перезапуск не удался. Перезапусти Obsidian один раз.`, 12000);
      }
    }, 150);

    return true;
  } catch (e) {
    console.error("[Updater Plugin] self-update failed:", e);

    try {
      for (const name of ["main.js", "manifest.json", "styles.css"]) {
        const old = path.join(rollback, name);
        const cur = path.join(pluginDir, name);
        if (await exists(old)) await fsp.copyFile(old, cur);
        else if (await exists(cur)) await fsp.rm(cur, { force: true });
      }
      await this.refreshPluginManifestCache(pluginId, local.manifest);
    } catch (rollbackError) {
      console.error("[Updater Plugin] self rollback failed:", rollbackError);
    }

    new Notice(`Самообновление Updater Plugin не удалось: ${e.message}`, 10000);
    return false;
  }
}

  async installPreparedPlugin(info) {
    const { entry, local, remoteManifest, remoteManifestText, mainJs, stylesCss, hasStyles } = info;
    const pluginId = local.id;
    const pluginDir = local.dir;

    const rollback = path.join(
      this.getPluginsRoot(),
      this.manifest.id,
      "rollback",
      pluginId,
      `${local.version}_${stamp()}`
    );

    try {
      await fsp.mkdir(rollback, { recursive: true });

      await Promise.all(["main.js", "manifest.json", "styles.css"].map(async name => {
        const src = path.join(pluginDir, name);
        if (await exists(src)) {
          await fsp.copyFile(src, path.join(rollback, name));
        }
      }));

      const api = this.app.plugins;
      const wasEnabled = !!api?.enabledPlugins?.has(pluginId);

      if (wasEnabled && api?.disablePlugin) {
        await api.disablePlugin(pluginId);
      }

      try {
        const writes = [
          fsp.writeFile(path.join(pluginDir, "main.js"), mainJs, "utf8"),
          fsp.writeFile(path.join(pluginDir, "manifest.json"), remoteManifestText, "utf8")
        ];

        if (hasStyles) {
          writes.push(
            fsp.writeFile(path.join(pluginDir, "styles.css"), stylesCss, "utf8")
          );
        }

        await Promise.all(writes);

        if (!hasStyles) {
          const css = path.join(pluginDir, "styles.css");
          if (await exists(css)) await fsp.rm(css, { force: true });
        }

        await this.refreshPluginManifestCache(pluginId, remoteManifest);

        if (wasEnabled && api?.enablePlugin) {
          await api.enablePlugin(pluginId);
        }

        new Notice(`${local.name}: ${local.version} → ${remoteManifest.version}`);
        return true;
      } catch (e) {
        await Promise.all(["main.js", "manifest.json", "styles.css"].map(async name => {
          const old = path.join(rollback, name);
          const cur = path.join(pluginDir, name);

          if (await exists(old)) await fsp.copyFile(old, cur);
          else if (await exists(cur)) await fsp.rm(cur, { force: true });
        }));

        await this.refreshPluginManifestCache(pluginId, local.manifest);

        if (wasEnabled && api?.enablePlugin) {
          try { await api.enablePlugin(pluginId); } catch {}
        }

        throw new Error(`Старая версия возвращена: ${e.message}`);
      }
    } catch (e) {
      console.error("[Updater Plugin] install failed:", pluginId, e);
      new Notice(`${local.name}: ${e.message}`, 10000);
      return false;
    }
  }
};
