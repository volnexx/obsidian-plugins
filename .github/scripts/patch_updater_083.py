from pathlib import Path
import json

p = Path('updater-plugin/main.js')
s = p.read_text(encoding='utf-8')

needle = '''    const remoteName = this.normalizePluginIdentity(entry.name || entry.manifest?.name);

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

    return { local: null, matchedBy: "none", ambiguous: false };
'''

replacement = '''    const remoteName = this.normalizePluginIdentity(entry.name || entry.manifest?.name);

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
'''

if needle not in s:
    raise SystemExit('matchRemoteToLocal insertion point not found')
s = s.replace(needle, replacement, 1)

method_marker = '''  matchRemoteToLocal(entry, installed) {
'''
helper = '''  pluginNameTokens(value) {
    const stop = new Set(["obsidian", "plugin", "plugins", "плагин", "плагины"]);
    const words = String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .match(/[a-z0-9а-яё]+/giu) || [];
    return new Set(words.filter(word => word.length >= 2 && !stop.has(word)));
  }

'''
if method_marker not in s:
    raise SystemExit('matchRemoteToLocal marker not found')
s = s.replace(method_marker, helper + method_marker, 1)

p.write_text(s, encoding='utf-8')

mpath = Path('updater-plugin/manifest.json')
m = json.loads(mpath.read_text(encoding='utf-8'))
m['version'] = '0.8.3'
m['description'] = 'Обновляет плагины без горячего отключения и распознаёт переименованные версии по id, папке, имени и безопасному совпадению автора+названия.'
mpath.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

rpath = Path('registry.json')
if rpath.exists():
    r = json.loads(rpath.read_text(encoding='utf-8'))
    for item in r.get('plugins', []):
        if item.get('id') == 'updater-plugin':
            item['version'] = '0.8.3'
    rpath.write_text(json.dumps(r, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
