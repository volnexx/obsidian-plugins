from pathlib import Path
import json

p = Path('updater-plugin/main.js')
s = p.read_text(encoding='utf-8')
old = '''  async rawText(repo, branch, file) {
    const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${file}`;
    const r = await requestUrl({ url, method: "GET" });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`${repo}/${file}: HTTP ${r.status}`);
    }
    return r.text;
  }
'''
new = '''  async rawText(repo, branch, file) {
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
'''
if old not in s: raise SystemExit('rawText method not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
mp=Path('updater-plugin/manifest.json')
m=json.loads(mp.read_text(encoding='utf-8')); m['version']='0.8.5'; m['description']='Обновляет плагины без горячего отключения, проверяет целостность файлов и всегда запрашивает свежие файлы GitHub без Raw-кэша.'; mp.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
rp=Path('registry.json')
if rp.exists():
 r=json.loads(rp.read_text(encoding='utf-8'))
 for item in r.get('plugins',[]):
  if item.get('id')=='updater-plugin': item['version']='0.8.5'
 rp.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
