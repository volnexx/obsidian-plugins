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
  registryRepo: "volnexx/obsidian-plugins",
  registryBranch: "centralize-plugins",
  backupRoot: "",
  keepBackups: 10,
  fastBackup: true
};

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

class UpdaterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

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
      .setDesc("Одна резервная копия → обновление установленных и установка новых наших плагинов.")
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

    const updateRibbon = this.addRibbonIcon("refresh-cw", "Обновить все наши плагины", () => this.safeUpdateAll());
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

    this.addSettingTab(new UpdaterSettingTab(this.app, this));
  }

  onunload() {
    for (const el of this._restoreActionElements || []) {
      try { el.remove(); } catch {}
    }
    this._restoreActionElements?.clear();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
    if (!this.node) return Promise.reject(new Error("Настольные команды недоступны."));
    const { spawn } = this.node;
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", d => stderr += String(d));
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(new Error(`${command}: ${stderr.trim()}`)));
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

  async rawText(repo, ref, file) {
    const r = await this.requestWithRetry(() => {
      const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        url: `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/${file}?updater=${cacheBust}`,
        method: "GET",
        headers: {
          "Cache-Control": "no-cache, no-store, max-age=0",
          "Pragma": "no-cache"
        }
      };
    }, `${repo}/${file}`);
    return r.text;
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
    const [owner, repo] = String(this.settings.registryRepo || "").split("/");
    if (!owner || !repo) throw new Error("Центральный репозиторий должен быть owner/repository.");
    const branch = this.settings.registryBranch || "main";
    const revision = await this.resolveRepositoryRevision(owner, repo, branch);
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(revision)}`;
    const root = await this.githubJson(url);
    if (!Array.isArray(root)) throw new Error("Не удалось получить корень репозитория.");

    const dirs = root.filter(x => x?.type === "dir" && x?.name && x.name !== ".github" && !x.name.startsWith("."));
    const plugins = [];
    for (const d of dirs) {
      const prefix = `${String(d.path).replace(/\/+$/u, "")}/`;
      try {
        const [manifestText] = await Promise.all([
          this.rawText(this.settings.registryRepo, revision, `${prefix}manifest.json`),
          this.rawText(this.settings.registryRepo, revision, `${prefix}main.js`)
        ]);
        const manifest = JSON.parse(manifestText);
        if (!manifest?.id || !manifest?.version) continue;
        plugins.push({
          id: manifest.id,
          name: manifest.name || manifest.id,
          version: manifest.version,
          path: d.path,
          manifest,
          sourceRef: revision
        });
      } catch (error) {
        console.warn(`[Updater Plugin] Пропущена папка ${d.path}:`, error);
      }
    }

    new Notice(`Папок проверено: ${dirs.length}. Плагинов найдено: ${plugins.length}.`);
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
      repo: this.settings.registryRepo,
      branch: entry.sourceRef || this.settings.registryBranch || "main",
      prefix: entry.path ? `${String(entry.path).replace(/\/+$/u, "")}/` : ""
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
    const checked = await Promise.all(plugins.map(async p => {
      const cmp = compareVersions(p.entry.version, p.local.version);
      if (cmp > 0) return { ...p, updateReason: "version" };
      if (cmp < 0) return null;
      return await this.pluginFilesDiffer(p) ? { ...p, updateReason: "files" } : null;
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

  async safeUpdateAll() {
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
