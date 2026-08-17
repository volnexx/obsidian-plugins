import json
from pathlib import Path

p = Path('updater-plugin/main.js')
text = p.read_text()

old = '''  async rawText(repo, ref, file) {
    const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/${file}?updater=${cacheBust}`;
    const r = await requestUrl({
      url,
      method: "GET",
      headers: {
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache"
      }
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`${repo}/${file}: HTTP ${r.status}`);
    return r.text;
  }

  async githubJson(url) {
    const sep = url.includes("?") ? "&" : "?";
    const freshUrl = `${url}${sep}updater=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const r = await requestUrl({
      url: freshUrl,
      method: "GET",
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Updater-Plugin",
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache"
      }
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`GitHub API HTTP ${r.status}`);
    return r.json;
  }
'''

new = '''  isRetryableNetworkError(error) {
    const message = String(error?.message || error || "");
    const explicitStatus = Number(error?.status || 0);
    const match = message.match(/(?:status|HTTP)\\s*(\\d{3})/iu);
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
'''

if old not in text:
    raise SystemExit('network block not found')
text = text.replace(old, new, 1)

old2 = '''    const dirs = root.filter(x => x?.type === "dir" && x?.name && x.name !== ".github" && !x.name.startsWith("."));
    const plugins = (await Promise.all(dirs.map(async d => {
      const prefix = `${String(d.path).replace(/\\/+$/u, "")}/`;
      try {
        const [manifestText] = await Promise.all([
          this.rawText(this.settings.registryRepo, revision, `${prefix}manifest.json`),
          this.rawText(this.settings.registryRepo, revision, `${prefix}main.js`)
        ]);
        const manifest = JSON.parse(manifestText);
        if (!manifest?.id || !manifest?.version) return null;
        return {
          id: manifest.id,
          name: manifest.name || manifest.id,
          version: manifest.version,
          path: d.path,
          manifest,
          sourceRef: revision
        };
      } catch {
        return null;
      }
    }))).filter(Boolean);
'''

new2 = '''    const dirs = root.filter(x => x?.type === "dir" && x?.name && x.name !== ".github" && !x.name.startsWith("."));
    const plugins = [];
    for (const d of dirs) {
      const prefix = `${String(d.path).replace(/\\/+$/u, "")}/`;
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
'''

if old2 not in text:
    raise SystemExit('directory scan block not found')
text = text.replace(old2, new2, 1)
p.write_text(text)

mp = Path('updater-plugin/manifest.json')
manifest = json.loads(mp.read_text())
manifest['version'] = '0.10.1'
mp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

rp = Path('registry.json')
registry = json.loads(rp.read_text())
for plugin in registry.get('plugins', []):
    if plugin.get('id') == 'updater-plugin':
        plugin['version'] = '0.10.1'
        break
else:
    raise SystemExit('updater-plugin missing from registry')
rp.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n')
