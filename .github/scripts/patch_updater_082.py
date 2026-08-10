from pathlib import Path
import json

p = Path('updater-plugin/main.js')
s = p.read_text(encoding='utf-8')

# Replace self-update with write-only logic. No hot disable/enable.
start = s.index('  async installSelfUpdate(info) {')
end = s.index('  async safeRefreshPluginManifestCache(', start)
new_self = '''  async installSelfUpdate(info) {
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

'''
s = s[:start] + new_self + s[end:]

# Replace ordinary plugin installation. Files are replaced while old code remains in memory.
# For manifest.id migrations, update community-plugins.json on disk so the new id remains enabled after reload.
start = s.index('  async installPreparedPlugin(info) {')
end = s.index('\n};', start)
new_install = '''  async updateEnabledPluginId(oldPluginId, newPluginId) {
    if (!oldPluginId || !newPluginId || oldPluginId === newPluginId) return null;
    const file = path.join(this.getVaultPath(), ".obsidian", "community-plugins.json");
    if (!(await exists(file))) return null;

    const original = await fsp.readFile(file, "utf8");
    let ids;
    try { ids = JSON.parse(original); } catch { return null; }
    if (!Array.isArray(ids) || !ids.includes(oldPluginId)) return { file, original, changed: false };

    const next = Array.from(new Set(ids.map(id => id === oldPluginId ? newPluginId : id)));
    await fsp.writeFile(file, JSON.stringify(next, null, 2) + "\\n", "utf8");
    return { file, original, changed: true };
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
  }'''
s = s[:start] + new_install + s[end:]

old_notice = '''      new Notice(
        `Готово за ${((Date.now() - started) / 1000).toFixed(1)} с. Обновлено: ${updated}; ошибок: ${failed}.`,
        10000
      );'''
new_notice = '''      new Notice(
        `Готово за ${((Date.now() - started) / 1000).toFixed(1)} с. Обновлено: ${updated}; ошибок: ${failed}. Перезапускаю Obsidian…`,
        10000
      );

      if (updated > 0) {
        setTimeout(() => {
          try { window.location.reload(); }
          catch (e) {
            console.error("[Updater Plugin] reload after update failed:", e);
            new Notice("Обновления записаны. Перезапусти Obsidian вручную один раз.", 10000);
          }
        }, 700);
      }'''
if old_notice not in s:
    raise SystemExit('final notice block not found')
s = s.replace(old_notice, new_notice, 1)

p.write_text(s, encoding='utf-8')

mpath = Path('updater-plugin/manifest.json')
m = json.loads(mpath.read_text(encoding='utf-8'))
m['version'] = '0.8.2'
m['description'] = 'Обновляет плагины без горячего отключения: резервная копия, запись файлов, сохранение состояния и один безопасный перезапуск Obsidian.'
mpath.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

rpath = Path('registry.json')
if rpath.exists():
    r = json.loads(rpath.read_text(encoding='utf-8'))
    for item in r.get('plugins', []):
        if item.get('id') == 'updater-plugin': item['version'] = '0.8.2'
    rpath.write_text(json.dumps(r, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
