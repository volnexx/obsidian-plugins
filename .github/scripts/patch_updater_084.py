from pathlib import Path
import json

p = Path('updater-plugin/main.js')
s = p.read_text(encoding='utf-8')

marker = '''  async checkOnly() {
'''
helper = r'''  async pluginFilesDiffer(info) {
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

'''

if marker not in s:
    raise SystemExit('checkOnly marker not found')
s = s.replace(marker, helper + marker, 1)

old = '''      const updates = plugins.filter(p =>
        compareVersions(p.entry.version, p.local.version) > 0
      );'''
new = '''      const updates = await this.findUpdates(plugins);'''
count = s.count(old)
if count != 2:
    raise SystemExit(f'expected 2 update filters, found {count}')
s = s.replace(old, new)

old_notice = '''        updates.map(p => `${p.local.name} ${p.local.version} → ${p.entry.version}`).join("; "),'''
new_notice = '''        updates.map(p => p.updateReason === "files"
          ? `${p.local.name} ${p.local.version} — файлы отличаются от репозитория`
          : `${p.local.name} ${p.local.version} → ${p.entry.version}`
        ).join("; "),'''
if old_notice not in s:
    raise SystemExit('check notice mapping not found')
s = s.replace(old_notice, new_notice, 1)

p.write_text(s, encoding='utf-8')

mpath = Path('updater-plugin/manifest.json')
m = json.loads(mpath.read_text(encoding='utf-8'))
m['version'] = '0.8.4'
m['description'] = 'Обновляет плагины по версии и дополнительно чинит рассинхрон: при одинаковой версии сравнивает реальные main.js, manifest.json и styles.css.'
mpath.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

rpath = Path('registry.json')
if rpath.exists():
    r = json.loads(rpath.read_text(encoding='utf-8'))
    for item in r.get('plugins', []):
        if item.get('id') == 'updater-plugin':
            item['version'] = '0.8.4'
    rpath.write_text(json.dumps(r, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
