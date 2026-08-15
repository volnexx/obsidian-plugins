from pathlib import Path
import json

main_path = Path('updater-plugin/main.js')
s = main_path.read_text(encoding='utf-8')

old_import = 'const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, FileSystemAdapter, setIcon } = require("obsidian");'
new_import = 'const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, FileSystemAdapter, setIcon, addIcon } = require("obsidian");'
if old_import not in s:
    raise SystemExit('Obsidian import marker not found')
s = s.replace(old_import, new_import, 1)

marker = 'const { spawn } = require("child_process");\n'
icon_code = '''const { spawn } = require("child_process");\n\nconst UPDATE_ALL_ICON = "updater-package-update";\nconst UPDATE_ALL_ICON_SVG = `\n  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l5 2.86a2 2 0 0 0 2 0l2-1.14"/>\n  <path d="m3.3 7 8.7 5 8.7-5"/>\n  <path d="M12 22V12"/>\n  <path d="M17 14v7"/>\n  <path d="m14 18 3 3 3-3"/>\n`;\n'''
if marker not in s:
    raise SystemExit('child_process marker not found')
s = s.replace(marker, icon_code, 1)

old_ribbon = '    this.addRibbonIcon("refresh-cw", "Обновить все наши плагины", () => this.safeUpdateAll());'
new_ribbon = '''    try { addIcon(UPDATE_ALL_ICON, UPDATE_ALL_ICON_SVG); } catch (e) {\n      console.warn("[Updater Plugin] Не удалось зарегистрировать значок обновления:", e);\n    }\n    this.addRibbonIcon(UPDATE_ALL_ICON, "Обновить все наши плагины", () => this.safeUpdateAll());'''
if old_ribbon not in s:
    raise SystemExit('ribbon icon marker not found')
s = s.replace(old_ribbon, new_ribbon, 1)
main_path.write_text(s, encoding='utf-8')

manifest_path = Path('updater-plugin/manifest.json')
m = json.loads(manifest_path.read_text(encoding='utf-8'))
m['version'] = '0.9.1'
manifest_path.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

registry_path = Path('registry.json')
if registry_path.exists():
    try:
        r = json.loads(registry_path.read_text(encoding='utf-8'))
        changed = False
        for item in r.get('plugins', []):
            if item.get('id') == 'updater-plugin':
                item['version'] = '0.9.1'
                changed = True
        if changed:
            registry_path.write_text(json.dumps(r, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    except Exception:
        pass
