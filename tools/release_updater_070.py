from pathlib import Path
import json, re

p = Path('updater-plugin/main.js')
s = p.read_text()

s = s.replace('  registryPath: "registry.json",\n', '')
s = s.replace('Репозиторий с registry.json.', 'Репозиторий, в корне которого лежат папки наших плагинов.')
s = s.replace('Ветка реестра', 'Ветка плагинов')
s = s.replace('Один реестр → одна резервная копия → обновление всех найденных наших плагинов.', 'Сканирование всех папок репозитория → одна резервная копия → обновление всех установленных наших плагинов.')

a = s.find('    new Setting(containerEl)\n      .setName("Путь к реестру")')
if a != -1:
    b = s.find('    new Setting(containerEl)', a + 20)
    if b != -1:
        s = s[:a] + s[b:]

raw_a = s.find('  async rawText(repo, branch, file) {')
fetch_a = s.find('  async fetchRegistry() {', raw_a)
if raw_a == -1 or fetch_a == -1:
    raise SystemExit('raw/fetch markers not found')
raw_block = s[raw_a:fetch_a]
helpers = raw_block + '''  async githubJson(url) {
    const r = await requestUrl({
      url,
      method: "GET",
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Updater-Plugin"
      }
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`GitHub API HTTP ${r.status}`);
    return r.json;
  }

  async listRepositoryPluginFolders() {
    const started = Date.now();
    const [owner, repo] = String(this.settings.registryRepo || "").split("/");
    if (!owner || !repo) throw new Error("Центральный репозиторий должен быть owner/repository.");

    const branch = this.settings.registryBranch || "main";
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`;
    const rootItems = await this.githubJson(url);
    if (!Array.isArray(rootItems)) throw new Error("GitHub не вернул список корня репозитория.");

    const dirs = rootItems.filter(item => item?.type === "dir" && item?.name && item.name !== ".github" && item.name !== "tools" && !item.name.startsWith("."));

    const discovered = (await Promise.all(dirs.map(async dir => {
      const prefix = `${dir.path.replace(/\\/+$/u, "")}/`;
      try {
        const [manifestText] = await Promise.all([
          this.rawText(this.settings.registryRepo, branch, `${prefix}manifest.json`),
          this.rawText(this.settings.registryRepo, branch, `${prefix}main.js`)
        ]);
        const manifest = JSON.parse(manifestText);
        if (!manifest?.id || !manifest?.version) return null;
        return { id: manifest.id, name: manifest.name || manifest.id, version: manifest.version, path: dir.path, manifest };
      } catch { return null; }
    }))).filter(Boolean);

    new Notice(`Папок проверено: ${dirs.length}. Плагинов найдено: ${discovered.length}. ${((Date.now()-started)/1000).toFixed(2)} с.`);
    return discovered;
  }

'''
s = s[:raw_a] + helpers + s[fetch_a:]

a = s.find('  async fetchRegistry() {')
b = s.find('  async readInstalledPlugins()', a)
if a == -1 or b == -1:
    raise SystemExit('fetchRegistry block not found')
s = s[:a] + s[b:]

a = s.find('  async resolveRegistryPlugins() {')
b = s.find('  async checkOnly() {', a)
if a == -1 or b == -1:
    raise SystemExit('resolve block not found')
s = s[:a] + '''  async resolveRegistryPlugins() {
    const [remotePlugins, installed] = await Promise.all([
      this.listRepositoryPluginFolders(),
      this.readInstalledPlugins()
    ]);
    const all = remotePlugins.map(entry => ({ entry, local: installed.get(entry.id) || null }));
    return { all, installed: all.filter(p => p.local) };
  }

''' + s[b:]

check_a = s.find('  async checkOnly() {')
check_b = s.find('  async createVaultBackup() {', check_a)
check = s[check_a:check_b]
check = check.replace('const plugins = await this.resolveRegistryPlugins();', 'const discovered = await this.resolveRegistryPlugins();\n      const plugins = discovered.installed;', 1)
check = check.replace('new Notice(`Наших установленных плагинов найдено: ${plugins.length}. Обновлений нет.`);', 'new Notice(`В репозитории: ${discovered.all.length}; установлено: ${plugins.length}; обновлений нет.`);', 1)
s = s[:check_a] + check + s[check_b:]

a = s.find('  sourceFor(entry) {')
b = s.find('  async prepareUpdate(info) {', a)
if a == -1 or b == -1:
    raise SystemExit('source block not found')
s = s[:a] + '''  sourceFor(entry) {
    return {
      repo: this.settings.registryRepo,
      branch: this.settings.registryBranch || "main",
      prefix: entry.path ? `${entry.path.replace(/\\/+$/u, "")}/` : ""
    };
  }

''' + s[b:]

safe_a = s.find('  async safeUpdateAll() {')
self_a = s.find('installSelfUpdate(info)', safe_a)
if safe_a == -1 or self_a == -1:
    raise SystemExit('safe/self markers not found')
safe_b = s.rfind('\n', safe_a, self_a)
safe = s[safe_a:safe_b]
safe = safe.replace('const plugins = await this.resolveRegistryPlugins();', 'const discovered = await this.resolveRegistryPlugins();\n    const plugins = discovered.installed;', 1)
safe = safe.replace('new Notice("Ни один установленный наш плагин не найден в центральном реестре.");', 'new Notice(`В репозитории найдено: ${discovered.all.length}; локально установлено: 0.`);', 1)
safe = safe.replace('new Notice(`Проверено ${plugins.length}. Обновлений нет.`);', 'new Notice(`В репозитории: ${discovered.all.length}; установлено: ${plugins.length}; обновлений нет.`);', 1)
s = s[:safe_a] + safe + s[safe_b:]

p.write_text(s)

mp = Path('updater-plugin/manifest.json')
m = json.loads(mp.read_text())
m['version'] = '0.7.0'
m['description'] = 'Auto-discovers every Obsidian plugin folder in a central GitHub repository, with backup, rollback/redo and self-update.'
mp.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')

rp = Path('registry.json')
reg = json.loads(rp.read_text())
for item in reg.get('plugins', []):
    if item.get('id') == 'updater-plugin':
        item['version'] = '0.7.0'
rp.write_text(json.dumps(reg, ensure_ascii=False, indent=2) + '\n')

readme = Path('updater-plugin/README.md')
t = re.sub(r'# Updater Plugin [0-9.]+', '# Updater Plugin 0.7.0', readme.read_text(), count=1)
t += '\n\n## 0.7.0\n\n- Updater автоматически сканирует все папки верхнего уровня центрального репозитория.\n- `registry.json` больше не задаёт список плагинов.\n- Папка считается плагином при наличии `manifest.json` и `main.js`.\n'
readme.write_text(t)
