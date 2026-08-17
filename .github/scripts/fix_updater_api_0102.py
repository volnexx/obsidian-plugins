import json
import re
from pathlib import Path

main_path = Path('updater-plugin/main.js')
text = main_path.read_text()

raw_pattern = re.compile(r'''  async rawText\(repo, ref, file\) \{.*?\n  \}\n\n  async githubJson\(url\) \{''', re.S)
raw_replacement = r'''  decodeBase64Utf8(value) {
    const compact = String(value || "").replace(/\s+/gu, "");
    const binary = globalThis.atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  async rawText(repo, ref, file) {
    const [owner, repository] = String(repo || "").split("/");
    if (!owner || !repository) throw new Error("Репозиторий должен быть owner/repository.");
    const encodedPath = String(file || "")
      .split("/")
      .filter(Boolean)
      .map(part => encodeURIComponent(part))
      .join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
    const data = await this.githubJson(url);
    if (!data || data.type !== "file") throw new Error(`${repo}/${file}: GitHub API не вернул файл.`);
    if (data.encoding !== "base64" || typeof data.content !== "string") {
      throw new Error(`${repo}/${file}: неподдерживаемый формат содержимого GitHub API.`);
    }
    return this.decodeBase64Utf8(data.content);
  }

  async githubJson(url) {'''
text, count = raw_pattern.subn(lambda _: raw_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'rawText block replacements: {count}')

list_pattern = re.compile(r'''  async listRepositoryPluginFolders\(\) \{.*?\n  \}\n\n  async readInstalledPlugins\(\) \{''', re.S)
list_replacement = r'''  async listRepositoryPluginFolders() {
    const [owner, repo] = String(this.settings.registryRepo || "").split("/");
    if (!owner || !repo) throw new Error("Центральный репозиторий должен быть owner/repository.");
    const branch = this.settings.registryBranch || "main";
    const revision = await this.resolveRepositoryRevision(owner, repo, branch);
    const registryText = await this.rawText(this.settings.registryRepo, revision, "registry.json");
    let registry;
    try {
      registry = JSON.parse(registryText);
    } catch {
      throw new Error("registry.json содержит некорректный JSON.");
    }
    if (!registry || !Array.isArray(registry.plugins)) throw new Error("registry.json не содержит список plugins.");

    const plugins = registry.plugins
      .filter(entry => entry && entry.id && entry.version && entry.path)
      .map(entry => ({
        id: String(entry.id),
        name: String(entry.name || entry.id),
        version: String(entry.version),
        path: String(entry.path),
        manifest: {
          id: String(entry.id),
          name: String(entry.name || entry.id),
          version: String(entry.version)
        },
        sourceRef: revision
      }));

    new Notice(`Реестр загружен: ${plugins.length} плагинов.`);
    return plugins;
  }

  async readInstalledPlugins() {'''
text, count = list_pattern.subn(lambda _: list_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'listRepositoryPluginFolders replacements: {count}')

find_pattern = re.compile(r'''  async findUpdates\(plugins\) \{.*?\n  \}\n\n  async checkOnly\(\) \{''', re.S)
find_replacement = r'''  async findUpdates(plugins) {
    return plugins
      .map(p => compareVersions(p.entry.version, p.local.version) > 0
        ? { ...p, updateReason: "version" }
        : null)
      .filter(Boolean);
  }

  async checkOnly() {'''
text, count = find_pattern.subn(lambda _: find_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'findUpdates replacements: {count}')

main_path.write_text(text)

manifest_path = Path('updater-plugin/manifest.json')
manifest = json.loads(manifest_path.read_text())
manifest['version'] = '0.10.2'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

registry_path = Path('registry.json')
registry = json.loads(registry_path.read_text())
found = False
for plugin in registry.get('plugins', []):
    if plugin.get('id') == 'updater-plugin':
        plugin['version'] = '0.10.2'
        found = True
if not found:
    raise SystemExit('updater-plugin missing from registry.json')
registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n')
