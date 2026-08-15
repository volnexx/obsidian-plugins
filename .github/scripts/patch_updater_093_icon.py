from pathlib import Path
import json

main_path = Path('updater-plugin/main.js')
s = main_path.read_text(encoding='utf-8')

s = s.replace(
    'const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, FileSystemAdapter, setIcon, addIcon } = require("obsidian");',
    'const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, FileSystemAdapter, setIcon } = require("obsidian");',
    1
)

start = s.find('const UPDATE_ALL_ICON = "updater-plugin-cycle-p";')
if start != -1:
    end_marker = '`;\n\nconst DEFAULT_SETTINGS'
    end = s.find(end_marker, start)
    if end == -1:
        raise SystemExit('custom icon block end not found')
    s = s[:start] + 'const DEFAULT_SETTINGS' + s[end + len(end_marker):]

old = '''    try { addIcon(UPDATE_ALL_ICON, UPDATE_ALL_ICON_SVG); } catch (e) {
      console.warn("[Updater Plugin] Не удалось зарегистрировать значок обновления:", e);
    }
    this.addRibbonIcon(UPDATE_ALL_ICON, "Обновить все наши плагины", () => this.safeUpdateAll());'''

new = '''    const updateRibbon = this.addRibbonIcon("refresh-cw", "Обновить все наши плагины", () => this.safeUpdateAll());
    if (updateRibbon) {
      updateRibbon.style.position = "relative";
      const mark = document.createElement("span");
      mark.textContent = "P";
      mark.setAttribute("aria-hidden", "true");
      Object.assign(mark.style, {
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        fontSize: "8px",
        lineHeight: "1",
        fontWeight: "800",
        fontFamily: "var(--font-interface)",
        color: "currentColor",
        pointerEvents: "none",
        zIndex: "2"
      });
      updateRibbon.appendChild(mark);
    }'''

if old not in s:
    raise SystemExit('old custom ribbon block not found')
s = s.replace(old, new, 1)
main_path.write_text(s, encoding='utf-8')

manifest_path = Path('updater-plugin/manifest.json')
m = json.loads(manifest_path.read_text(encoding='utf-8'))
m['version'] = '0.9.3'
m['description'] = 'Обновляет плагины из общего репозитория; кнопка обновления использует встроенные стрелки Obsidian с буквой P по центру.'
manifest_path.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

registry_path = Path('registry.json')
if registry_path.exists():
    try:
        r = json.loads(registry_path.read_text(encoding='utf-8'))
        changed = False
        for item in r.get('plugins', []):
            if item.get('id') == 'updater-plugin':
                item['version'] = '0.9.3'
                changed = True
        if changed:
            registry_path.write_text(json.dumps(r, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    except Exception:
        pass
