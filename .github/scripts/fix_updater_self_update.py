from pathlib import Path
import json

p = Path('updater-plugin/main.js')
s = p.read_text()

if 'async refreshPluginManifestCache' not in s:
    marker = '  async installPreparedPlugin(info) {'
    method = '''  async refreshPluginManifestCache(pluginId, manifest) {\n    const api = this.app.plugins;\n\n    try {\n      if (typeof api?.loadManifests === "function") {\n        await api.loadManifests();\n      }\n    } catch (e) {\n      console.warn("[Updater Plugin] loadManifests failed:", e);\n    }\n\n    try {\n      if (api?.manifests) api.manifests[pluginId] = manifest;\n      const loaded = api?.plugins?.[pluginId];\n      if (loaded && manifest) loaded.manifest = manifest;\n    } catch (e) {\n      console.warn("[Updater Plugin] manifest cache refresh failed:", e);\n    }\n\n    try {\n      const activeTab = this.app.setting?.activeTab;\n      if (activeTab && typeof activeTab.display === "function") {\n        const id = String(activeTab.id || activeTab.constructor?.name || "").toLowerCase();\n        if (id.includes("community") || id.includes("plugin")) activeTab.display();\n      }\n    } catch (e) {\n      console.warn("[Updater Plugin] settings UI refresh failed:", e);\n    }\n  }\n\n'''
    if marker not in s:
        raise SystemExit('installPreparedPlugin marker not found')
    s = s.replace(marker, method + marker, 1)

s = s.replace(
    '      await this.refreshPluginManifestCache(pluginId, remoteManifest);',
    '      try {\n        await this.refreshPluginManifestCache(pluginId, remoteManifest);\n      } catch (cacheError) {\n        console.warn("[Updater Plugin] self-update cache refresh skipped:", cacheError);\n      }',
    1
)
s = s.replace(
    '        await this.refreshPluginManifestCache(pluginId, local.manifest);',
    '        try {\n          await this.refreshPluginManifestCache(pluginId, local.manifest);\n        } catch (cacheError) {\n          console.warn("[Updater Plugin] rollback cache refresh skipped:", cacheError);\n        }',
    1
)
p.write_text(s)

mp = Path('updater-plugin/manifest.json')
m = json.loads(mp.read_text())
m['version'] = '0.6.1'
m['description'] = 'One-button updater with central registry, vault rollback/redo and reliable self-update.'
mp.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')

rp = Path('registry.json')
r = json.loads(rp.read_text())
for item in r.get('plugins', []):
    if item.get('id') == 'updater-plugin':
        item['version'] = '0.6.1'
        break
rp.write_text(json.dumps(r, ensure_ascii=False, indent=2) + '\n')
