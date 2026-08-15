from pathlib import Path
import json

p = Path('updater-plugin/main.js')
s = p.read_text(encoding='utf-8')

old_icon = '''const UPDATE_ALL_ICON = "updater-package-update";
const UPDATE_ALL_ICON_SVG = `
  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l5 2.86a2 2 0 0 0 2 0l2-1.14"/>
  <path d="m3.3 7 8.7 5 8.7-5"/>
  <path d="M12 22V12"/>
  <path d="M17 14v7"/>
  <path d="m14 18 3 3 3-3"/>
`;
'''
new_icon = '''const UPDATE_ALL_ICON = "updater-plugin-cycle-p";
const UPDATE_ALL_ICON_SVG = `
  <path d="M20 7v5h-5"/>
  <path d="M4 17v-5h5"/>
  <path d="M6.3 8.2A7 7 0 0 1 18.5 6.7L20 8"/>
  <path d="M17.7 15.8A7 7 0 0 1 5.5 17.3L4 16"/>
  <path d="M10 16V8h3a3 3 0 0 1 0 6h-3"/>
`;
'''
if old_icon not in s:
    raise SystemExit('old icon block not found')
s = s.replace(old_icon, new_icon, 1)

old_github = '''  async githubJson(url) {
    const r = await requestUrl({
      url, method: "GET",
      headers: { "Accept": "application/vnd.github+json", "User-Agent": "Updater-Plugin" }
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`GitHub API HTTP ${r.status}`);
    return r.json;
  }
'''
new_github = '''  async githubJson(url) {
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

  async resolveRepositoryRevision(owner, repo, branch) {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`;
    const commit = await this.githubJson(url);
    const sha = String(commit?.sha || "").trim();
    if (!/^[0-9a-f]{40}$/iu.test(sha)) {
      throw new Error(`Не удалось определить последний commit SHA ветки ${branch}.`);
    }
    return sha;
  }
'''
if old_github not in s:
    raise SystemExit('githubJson block not found')
s = s.replace(old_github, new_github, 1)

old_list_start = '''    const branch = this.settings.registryBranch || "main";
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`;
    const root = await this.githubJson(url);
'''
new_list_start = '''    const branch = this.settings.registryBranch || "main";
    const revision = await this.resolveRepositoryRevision(owner, repo, branch);
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(revision)}`;
    const root = await this.githubJson(url);
'''
if old_list_start not in s:
    raise SystemExit('repository list start not found')
s = s.replace(old_list_start, new_list_start, 1)

old_raw_reads = '''          this.rawText(this.settings.registryRepo, branch, `${prefix}manifest.json`),
          this.rawText(this.settings.registryRepo, branch, `${prefix}main.js`)
'''
new_raw_reads = '''          this.rawText(this.settings.registryRepo, revision, `${prefix}manifest.json`),
          this.rawText(this.settings.registryRepo, revision, `${prefix}main.js`)
'''
if old_raw_reads not in s:
    raise SystemExit('repository raw reads not found')
s = s.replace(old_raw_reads, new_raw_reads, 1)

old_return = '''        return { id:manifest.id, name:manifest.name||manifest.id, version:manifest.version, path:d.path, manifest };
'''
new_return = '''        return { id:manifest.id, name:manifest.name||manifest.id, version:manifest.version, path:d.path, manifest, sourceRef:revision };
'''
if old_return not in s:
    raise SystemExit('plugin entry return not found')
s = s.replace(old_return, new_return, 1)

old_source = '''  sourceFor(entry) {
    return { repo: this.settings.registryRepo, branch: this.settings.registryBranch || "main", prefix: entry.path ? `${entry.path.replace(/\\/+$/u, "")}/` : "" };
  }
'''
new_source = '''  sourceFor(entry) {
    return {
      repo: this.settings.registryRepo,
      branch: entry.sourceRef || this.settings.registryBranch || "main",
      prefix: entry.path ? `${entry.path.replace(/\\/+$/u, "")}/` : ""
    };
  }
'''
if old_source not in s:
    raise SystemExit('sourceFor block not found')
s = s.replace(old_source, new_source, 1)

p.write_text(s, encoding='utf-8')

mp = Path('updater-plugin/manifest.json')
m = json.loads(mp.read_text(encoding='utf-8'))
m['version'] = '0.9.2'
m['description'] = 'Одной кнопкой обновляет плагины из общего репозитория, фиксируя точный commit SHA ветки для надёжного обнаружения новых версий.'
mp.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

rp = Path('registry.json')
if rp.exists():
    try:
        r = json.loads(rp.read_text(encoding='utf-8'))
        for item in r.get('plugins', []):
            if item.get('id') == 'updater-plugin':
                item['version'] = '0.9.2'
        rp.write_text(json.dumps(r, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    except Exception:
        pass
