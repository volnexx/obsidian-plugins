const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, FileSystemAdapter, setIcon, addIcon } = require("obsidian");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");

const UPDATE_ALL_ICON = "updater-package-update";
const UPDATE_ALL_ICON_SVG = `
  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l5 2.86a2 2 0 0 0 2 0l2-1.14"/>
  <path d="m3.3 7 8.7 5 8.7-5"/>
  <path d="M12 22V12"/>
  <path d="M17 14v7"/>
  <path d="m14 18 3 3 3-3"/>
`;

const DEFAULT_SETTINGS = {
  registryRepo: "volnexx/obsidian-plugins",
  registryBranch: "centralize-plugins",
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
      .setDesc("Репозиторий, в корне которого лежат папки наших плагинов.")
      .addText(t => t
        .setValue(this.plugin.settings.registryRepo)
        .onChange(async v => {
          this.plugin.settings.registryRepo = v.trim() || "volnexx/obsidian-plugins";
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
      .setDesc("Одна резервная копия → обновление установленных и установка новых наших плагинов.")
      .addButton(b => b
        .setButtonText("Обновить всё")
        .setCta()
        .onClick(() => this.plugin.safeUpdateAll()));
  }
}

module.exports = class UpdaterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this._restoreActionElements = new Set();
    this._restoreActionsByView = new WeakMap();
    this.app.workspace?.onLayoutReady?.(() => { void this.refreshRestoreActions(); });
    if (this.app.workspace?.on) {
      this.registerEvent(this.app.workspace.on("layout-change", () => { void this.refreshRestoreActions(); }));
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => { void this.refreshRestoreActions(); }));
    }

    try { addIcon(UPDATE_ALL_ICON, UPDATE_ALL_ICON_SVG); } catch (e) {
      console.warn("[Updater Plugin] Не удалось зарегистрировать значок обновления:", e);
    }
    this.addRibbonIcon(UPDATE_ALL_ICON, "Обновить все наши плагины", () => this.safeUpdateAll());

    this.addCommand({
      id: "safe-update-all-custom-plugins",
      name: "Обновить все наши плагины безопасно",
      callback: () => this.safeUpdateAll()
    });


    this.addSettingTab(new UpdaterSettingTab(this.app, this));
  }

  onunload() {
    for (const el of this._restoreActionElements || []) { try { el.remove(); } catch {} }
    this._restoreActionElements?.clear();
  }

  getRestoreStatePath() { return path.join(this.getBackupRoot(), "_updater-restore-state.json"); }

  async readRestoreState() {
    try {
      const p = this.getRestoreStatePath();
      if (!(await exists(p))) return { mode: "back", forwardPath: "" };
      const state = JSON.parse(await fsp.readFile(p, "utf8"));
      if (state?.mode === "redo" && state.forwardPath && await exists(state.forwardPath)) return state;
    } catch (e) { console.warn("[Updater Plugin] restore state:", e); }
    return { mode: "back", forwardPath: "" };
  }

  async writeRestoreState(state) {
    await fsp.mkdir(this.getBackupRoot(), { recursive: true });
    await fsp.writeFile(this.getRestoreStatePath(), JSON.stringify(state, null, 2), "utf8");
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
        this._restoreActionsByView.set(view, el); this._restoreActionElements.add(el);
      }
      try { setIcon?.(el, icon); el.setAttribute("aria-label", title); } catch {}
    }
  }

  async listUpdateBackups() {
    const root=this.getBackupRoot(); if (!(await exists(root))) return [];
    return (await fsp.readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name.endsWith("_before-update")).map(e=>path.join(root,e.name)).sort().reverse();
  }

  async createRestoreSnapshot() {
    const vault=this.getVaultPath(), root=this.getBackupRoot(), dst=path.join(root,`${stamp()}_before-rollback-forward`);
    await fsp.mkdir(root,{recursive:true});
    if (this.settings.fastBackup && process.platform === "linux") {
      try { await fsp.mkdir(dst,{recursive:true}); await runCommand("cp",["-a","--reflink=auto",`${vault}/.`,dst]); return dst; } catch { await fsp.rm(dst,{recursive:true,force:true}); }
    }
    await copyDirFallback(vault,dst); return dst;
  }

  async restoreVaultFromSnapshot(snapshot) {
    const vault=this.getVaultPath();
    if (!(await exists(path.join(snapshot,".obsidian")))) throw new Error("Некорректная резервная копия.");
    if (process.platform === "linux") {
      try {
        await runCommand("rsync",["-a","--delete","--exclude=.obsidian/plugins/updater-plugin/",`${snapshot}/`,`${vault}/`]);
        return;
      } catch (e) { console.warn("[Updater Plugin] rsync restore fallback:",e); }
    }
    await fsp.cp(snapshot,vault,{recursive:true,force:true});
  }

  async handleRestoreAction() {
    if (this._restoreBusy) return;
    this._restoreBusy=true;
    try {
      const state=await this.readRestoreState();
      if (state.mode === "redo" && state.forwardPath) {
        await this.restoreVaultFromSnapshot(state.forwardPath);
        try { await fsp.rm(state.forwardPath,{recursive:true,force:true}); } catch {}
        try { await fsp.rm(this.getRestoreStatePath(),{force:true}); } catch {}
      } else {
        const backups=await this.listUpdateBackups();
        if (!backups.length) { new Notice("Нет резервной копии для отката."); return; }
        const forward=await this.createRestoreSnapshot();
        await this.writeRestoreState({mode:"redo",forwardPath:forward,createdAt:new Date().toISOString()});
        await this.restoreVaultFromSnapshot(backups[0]);
      }
      new Notice("Хранилище восстановлено. Перезагружаю Obsidian…");
      setTimeout(()=>{ try { window.location.reload(); } catch {} },500);
    } catch (e) { console.error(e); new Notice(`Ошибка отката: ${e.message}`,10000); }
    finally { this._restoreBusy=false; }
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
    const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${file}?updater=${cacheBust}`;
    const r = await requestUrl({
      url,
      method: "GET",
      headers: {
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache"
      }
    });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`${repo}/${file}: HTTP ${r.status}`);
    }
    return r.text;
  }

  async githubJson(url) {
    const r = await requestUrl({
      url, method: "GET",
      headers: { "Accept": "application/vnd.github+json", "User-Agent": "Updater-Plugin" }
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`GitHub API HTTP ${r.status}`);
    return r.json;
  }

  async listRepositoryPluginFolders() {
    const [owner, repo] = String(this.settings.registryRepo || "").split("/");
    if (!owner || !repo) throw new Error("Центральный репозиторий должен быть owner/repository.");
    const branch = this.settings.registryBranch || "main";
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`;
    const root = await this.githubJson(url);
    if (!Array.isArray(root)) throw new Error("Не удалось получить корень репозитория.");
    const dirs = root.filter(x => x?.type === "dir" && x?.name && x.name !== ".github" && !x.name.startsWith("."));
    const plugins=(await Promise.all(dirs.map(async d=>{
      const prefix=`${d.path.replace(/\/+$/u, "")}/`;
      try {
        const [manifestText] = await Promise.all([
          this.rawText(this.settings.registryRepo, branch, `${prefix}manifest.json`),
          this.rawText(this.settings.registryRepo, branch, `${prefix}main.js`)
        ]);
        const manifest=JSON.parse(manifestText);
        if (!manifest?.id || !manifest?.version) return null;
        return { id:manifest.id, name:manifest.name||manifest.id, version:manifest.version, path:d.path, manifest };
      } catch { return null; }
    }))).filter(Boolean);
    new Notice(`Папок проверено: ${dirs.length}. Плагинов найдено: ${plugins.length}.`);
    return plugins;
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
            folderName: e.name,
            manifest: m
          });
        }
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
    const remoteFolder = this.normalizePluginIdentity(
      String(entry.path || "").split("/").filter(Boolean).pop()
    );

    if (remoteFolder) {
      const folderMatches = locals.filter(local =>
        this.normalizePluginIdentity(local.folderName) === remoteFolder
      );

      if (folderMatches.length === 1) {
        return { local: folderMatches[0], matchedBy: "folder", ambiguous: false };
      }
      if (folderMatches.length > 1) {
        return { local: null, matchedBy: "folder", ambiguous: true };
      }
    }

    const remoteName = this.normalizePluginIdentity(entry.name || entry.manifest?.name);

    if (remoteName) {
      const nameMatches = locals.filter(local =>
        this.normalizePluginIdentity(local.name || local.manifest?.name) === remoteName
      );

      if (nameMatches.length === 1) {
        return { local: nameMatches[0], matchedBy: "name", ambiguous: false };
      }
      if (nameMatches.length > 1) {
        return { local: null, matchedBy: "name", ambiguous: true };
      }
    }

    // Legacy fallback for renamed custom plugins.
    // Require the same non-empty author plus a strong token overlap in the name.
    // This avoids matching our custom plugin to an unrelated/community plugin with a similar title.
    const remoteAuthor = this.normalizePluginIdentity(entry.manifest?.author);
    const remoteTokens = this.pluginNameTokens(entry.name || entry.manifest?.name);

    if (remoteAuthor && remoteTokens.size) {
      const legacyMatches = locals.filter(local => {
        const localAuthor = this.normalizePluginIdentity(local.manifest?.author);
        if (!localAuthor || localAuthor !== remoteAuthor) return false;

        const localTokens = this.pluginNameTokens(local.name || local.manifest?.name);
        if (!localTokens.size) return false;

        const shared = [...remoteTokens].filter(token => localTokens.has(token));
        const coverage = shared.length / Math.min(remoteTokens.size, localTokens.size);
        return shared.length >= 2 && coverage >= 0.5;
      });

      if (legacyMatches.length === 1) {
        return { local: legacyMatches[0], matchedBy: "author+name", ambiguous: false };
      }
      if (legacyMatches.length > 1) {
        return { local: null, matchedBy: "author+name", ambiguous: true };
      }
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
      return {
        entry,
        local: match.local,
        matchedBy: match.matchedBy,
        ambiguous: match.ambiguous
      };
    });

    return {
      all,
      installed: all.filter(x => x.local && !x.ambiguous),
      missing: all.filter(x => !x.local && !x.ambiguous),
      ambiguous: all.filter(x => x.ambiguous)
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

      const localMainPath = path.join(local.dir, "main.js");
      const localManifestPath = path.join(local.dir, "manifest.json");
      const localStylesPath = path.join(local.dir, "styles.css");

      if (!(await exists(localMainPath)) || !(await exists(localManifestPath))) return true;

      const [localMain, localManifestText] = await Promise.all([
        fsp.readFile(localMainPath, "utf8"),
        fsp.readFile(localManifestPath, "utf8")
      ]);

      if (localMain !== remoteMain) return true;

      let remoteManifest, localManifest;
      try {
        remoteManifest = JSON.parse(remoteManifestText);
        localManifest = JSON.parse(localManifestText);
      } catch {
        return true;
      }

      for (const key of ["id", "name", "version", "minAppVersion", "description", "author", "isDesktopOnly"]) {
        if (JSON.stringify(remoteManifest?.[key]) !== JSON.stringify(localManifest?.[key])) return true;
      }

      const localHasStyles = await exists(localStylesPath);
      if (remoteStyles.exists !== localHasStyles) return true;
      if (remoteStyles.exists) {
        const localStyles = await fsp.readFile(localStylesPath, "utf8");
        if (localStyles !== remoteStyles.text) return true;
      }

      return false;
    } catch (e) {
      console.warn(`[Updater Plugin] integrity check skipped for ${local?.name || entry?.name}:`, e);
      return false;
    }
  }

  async findUpdates(plugins) {
    const checked = await Promise.all(plugins.map(async p => {
      const cmp = compareVersions(p.entry.version, p.local.version);
      if (cmp > 0) return { ...p, updateReason: "version" };
      if (cmp < 0) return null;

      const differs = await this.pluginFilesDiffer(p);
      return differs ? { ...p, updateReason: "files" } : null;
    }));
    return checked.filter(Boolean);
  }

  async checkOnly() {
    if (this._busy) {
      new Notice("Операция уже выполняется.");
      return;
    }

    this._busy = true;
    try {
      const discovered = await this.resolveRegistryPlugins();
      const plugins = discovered.installed;
      const newPlugins = discovered.missing;
      const updates = await this.findUpdates(plugins);

      if (!updates.length && !newPlugins.length) {
        new Notice(
          `В репозитории: ${discovered.all.length}; установлено: ${plugins.length}; обновлений и новых плагинов нет.`
        );
        return;
      }

      const parts = [];
      if (updates.length) {
        parts.push(
          `Обновлений: ${updates.length}. ` +
          updates.map(p => p.updateReason === "files"
            ? `${p.local.name} ${p.local.version} — файлы отличаются от репозитория`
            : `${p.local.name} ${p.local.version} → ${p.entry.version}`
          ).join("; ")
        );
      }
      if (newPlugins.length) {
        parts.push(`Новых плагинов: ${newPlugins.length}. ${newPlugins.map(p => p.entry.name).join("; ")}`);
      }
      new Notice(parts.join(" "), 12000);
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
    return { repo: this.settings.registryRepo, branch: this.settings.registryBranch || "main", prefix: entry.path ? `${entry.path.replace(/\/+$/u, "")}/` : "" };
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
      const discovered = await this.resolveRegistryPlugins();
      const plugins = discovered.installed;
      const newPlugins = discovered.missing;

      if (!plugins.length && !newPlugins.length) {
        new Notice(`В репозитории найдено: ${discovered.all.length}; доступных плагинов нет.`);
        return;
      }

      const migrated = plugins.filter(p => p.matchedBy !== "id");
      if (migrated.length) {
        new Notice(
          `Сопоставлены после переименования: ${migrated.map(p =>
            `${p.local.name} (${p.matchedBy})`
          ).join("; ")}`,
          8000
        );
      }

      if (discovered.ambiguous.length) {
        new Notice(
          `Неоднозначных совпадений: ${discovered.ambiguous.length}. Они пропущены для безопасности.`,
          8000
        );
      }

      const updates = await this.findUpdates(plugins);
      const pending = [
        ...updates,
        ...newPlugins.map(p => ({ ...p, updateReason: "new" }))
      ];

      if (!pending.length) {
        new Notice(
          `В репозитории: ${discovered.all.length}; установлено: ${plugins.length}; обновлений и новых плагинов нет.`
        );
        return;
      }

      new Notice(
        `Обновлений: ${updates.length}; новых плагинов: ${newPlugins.length}. Загружаю файлы…`
      );

      const preparedResults = await Promise.all(
        pending.map(p =>
          this.prepareUpdate(p)
            .then(value => ({ ok: true, value }))
            .catch(error => ({ ok: false, plugin: p, error }))
        )
      );

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

      const normalChanges = prepared.filter(p => p.entry.id !== this.manifest.id);
      const selfUpdate = prepared.find(p => p.entry.id === this.manifest.id) || null;

      let updated = 0;
      let installed = 0;
      let failed = failedDownloads.length;

      for (const info of normalChanges) {
        if (info.local) {
          if (await this.installPreparedPlugin(info)) updated++;
          else failed++;
        } else {
          if (await this.installNewPlugin(info)) installed++;
          else failed++;
        }
      }

      if (selfUpdate) {
        if (await this.installSelfUpdate(selfUpdate)) updated++;
        else failed++;
      }

      const changed = updated + installed;
      new Notice(
        `Готово за ${((Date.now() - started) / 1000).toFixed(1)} с. Обновлено: ${updated}; установлено: ${installed}; ошибок: ${failed}.` +
        (changed > 0 ? " Перезапускаю Obsidian…" : ""),
        10000
      );

      if (changed > 0) {
        setTimeout(() => {
          try { window.location.reload(); }
          catch (e) {
            console.error("[Updater Plugin] reload after update failed:", e);
            new Notice("Изменения записаны. Перезапусти Obsidian вручную один раз.", 10000);
          }
        }, 700);
      }
    } catch (e) {
      console.error("[Updater Plugin]", e);
      new Notice(`Ошибка обновления: ${e.message}`, 10000);
    } finally {
      this._busy = false;
    }
  }

  async installSelfUpdate(info) {
    const { local, remoteManifest, remoteManifestText, mainJs, stylesCss, hasStyles } = info;
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

      new Notice(`Updater Plugin: ${local.version} → ${remoteManifest.version}. Применится после перезапуска Obsidian.`);
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
      } catch (rollbackError) {
        console.error("[Updater Plugin] self rollback failed:", rollbackError);
      }
      new Notice(`Самообновление Updater Plugin не удалось: ${e.message}`, 10000);
      return false;
    }
  }

  async safeRefreshPluginManifestCache(pluginId, manifest) {
    try {
      if (typeof this.refreshPluginManifestCache === "function") await this.refreshPluginManifestCache(pluginId, manifest);
    } catch (e) {
      console.warn("[Updater Plugin] non-fatal manifest cache refresh error:", e);
    }
  }

  async refreshPluginManifestCache(pluginId, manifest) {
    const api = this.app.plugins;

    try {
      if (typeof api?.loadManifests === "function") {
        await api.loadManifests();
      }
    } catch (e) {
      console.warn("[Updater Plugin] loadManifests failed:", e);
    }

    try {
      if (api?.manifests) {
        api.manifests[pluginId] = manifest;
      }

      const loaded = api?.plugins?.[pluginId];
      if (loaded && manifest) {
        loaded.manifest = manifest;
      }
    } catch (e) {
      console.warn("[Updater Plugin] manifest cache refresh failed:", e);
    }

    try {
      const setting = this.app.setting;
      const activeTab = setting?.activeTab;
      if (activeTab && typeof activeTab.display === "function") {
        const id = String(activeTab.id || activeTab.constructor?.name || "").toLowerCase();
        if (id.includes("community") || id.includes("plugin")) {
          activeTab.display();
        }
      }
    } catch (e) {
      console.warn("[Updater Plugin] settings UI refresh failed:", e);
    }
  }

  async updateEnabledPluginId(oldPluginId, newPluginId) {
    if (!oldPluginId || !newPluginId || oldPluginId === newPluginId) return null;
    const file = path.join(this.getVaultPath(), ".obsidian", "community-plugins.json");
    if (!(await exists(file))) return null;

    const original = await fsp.readFile(file, "utf8");
    let ids;
    try { ids = JSON.parse(original); } catch { return null; }
    if (!Array.isArray(ids) || !ids.includes(oldPluginId)) return { file, original, changed: false };

    const next = Array.from(new Set(ids.map(id => id === oldPluginId ? newPluginId : id)));
    await fsp.writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
    return { file, original, changed: true };
  }

  async addEnabledPluginId(pluginId) {
    const file = path.join(this.getVaultPath(), ".obsidian", "community-plugins.json");
    const existed = await exists(file);
    const original = existed ? await fsp.readFile(file, "utf8") : null;

    let ids = [];
    if (original !== null) {
      try { ids = JSON.parse(original); }
      catch { throw new Error("community-plugins.json содержит некорректный JSON."); }
    }
    if (!Array.isArray(ids)) {
      throw new Error("community-plugins.json должен содержать список плагинов.");
    }
    if (ids.includes(pluginId)) {
      return { file, original, existed, changed: false };
    }

    await fsp.writeFile(file, JSON.stringify([...ids, pluginId], null, 2) + "\n", "utf8");
    return { file, original, existed, changed: true };
  }

  async restoreEnabledPluginIds(state) {
    if (!state?.changed) return;
    if (state.existed) await fsp.writeFile(state.file, state.original, "utf8");
    else await fsp.rm(state.file, { force: true });
  }

  async installNewPlugin(info) {
    const { entry, remoteManifest, remoteManifestText, mainJs, stylesCss, hasStyles } = info;
    const pluginId = String(remoteManifest.id || "").trim();
    const root = this.getPluginsRoot();
    let pluginDir = "";
    let tempDir = "";
    let installedDirCreated = false;
    let enabledState = null;

    try {
      if (!/^[a-z0-9][a-z0-9_-]*$/iu.test(pluginId)) {
        throw new Error(`Недопустимый ID плагина: ${pluginId || "пусто"}`);
      }

      pluginDir = path.join(root, pluginId);
      if (path.dirname(pluginDir) !== root) {
        throw new Error("Путь установки выходит за пределы папки плагинов.");
      }
      if (await exists(pluginDir)) {
        throw new Error(`Папка ${pluginId} уже существует, но установленный плагин в ней не распознан.`);
      }

      await fsp.mkdir(root, { recursive: true });
      tempDir = await fsp.mkdtemp(path.join(root, `.${pluginId}-install-`));

      const writes = [
        fsp.writeFile(path.join(tempDir, "main.js"), mainJs, "utf8"),
        fsp.writeFile(path.join(tempDir, "manifest.json"), remoteManifestText, "utf8")
      ];
      if (hasStyles) {
        writes.push(fsp.writeFile(path.join(tempDir, "styles.css"), stylesCss, "utf8"));
      }
      await Promise.all(writes);

      const writtenManifest = JSON.parse(await fsp.readFile(path.join(tempDir, "manifest.json"), "utf8"));
      if (writtenManifest.id !== pluginId || !(await exists(path.join(tempDir, "main.js")))) {
        throw new Error("Проверка скачанных файлов не пройдена.");
      }

      await fsp.rename(tempDir, pluginDir);
      tempDir = "";
      installedDirCreated = true;

      enabledState = await this.addEnabledPluginId(pluginId);
      await this.safeRefreshPluginManifestCache(pluginId, remoteManifest);

      new Notice(`${entry.name}: установлен ${remoteManifest.version}; включится после перезапуска Obsidian.`);
      return true;
    } catch (e) {
      console.error("[Updater Plugin] new plugin install failed:", pluginId || entry?.id, e);
      try { await this.restoreEnabledPluginIds(enabledState); }
      catch (rollbackError) {
        console.error("[Updater Plugin] enabled plugins rollback failed:", rollbackError);
      }
      try {
        if (installedDirCreated && pluginDir) await fsp.rm(pluginDir, { recursive: true, force: true });
        if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true });
      } catch (rollbackError) {
        console.error("[Updater Plugin] new plugin files rollback failed:", rollbackError);
      }
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

    const rollback = path.join(
      this.getPluginsRoot(), this.manifest.id, "rollback", oldPluginId,
      `${local.version}_${stamp()}`
    );

    let enabledIdState = null;

    try {
      await fsp.mkdir(rollback, { recursive: true });
      await Promise.all(["main.js", "manifest.json", "styles.css"].map(async name => {
        const src = path.join(pluginDir, name);
        if (await exists(src)) await fsp.copyFile(src, path.join(rollback, name));
      }));

      if (idChanged) enabledIdState = await this.updateEnabledPluginId(oldPluginId, newPluginId);

      try {
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

        const migrationSuffix = idChanged ? `; id: ${oldPluginId} → ${newPluginId}` : "";
        new Notice(`${local.name}: ${local.version} → ${remoteManifest.version}${migrationSuffix}`);
        return true;
      } catch (e) {
        await Promise.all(["main.js", "manifest.json", "styles.css"].map(async name => {
          const old = path.join(rollback, name);
          const cur = path.join(pluginDir, name);
          if (await exists(old)) await fsp.copyFile(old, cur);
          else if (await exists(cur)) await fsp.rm(cur, { force: true });
        }));
        if (enabledIdState?.changed) await fsp.writeFile(enabledIdState.file, enabledIdState.original, "utf8");
        throw new Error(`Старая версия возвращена: ${e.message}`);
      }
    } catch (e) {
      console.error("[Updater Plugin] install failed:", oldPluginId, e);
      new Notice(`${local.name}: ${e.message}`, 10000);
      return false;
    }
  }
};
