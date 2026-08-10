from pathlib import Path
import json

root = Path('style-settings-plugin')
core_path = root / 'main-core.js'
wrapper_path = root / 'main.js'
manifest_path = root / 'manifest.json'

core = core_path.read_text(encoding='utf-8')
wrapper = wrapper_path.read_text(encoding='utf-8')

needle = "module.exports=class StyleSettingsColorCyclePlugin extends Plugin"
if needle not in core:
    raise SystemExit('core export marker not found')
core = core.replace(needle, "class StyleSettingsColorCyclePlugin extends Plugin", 1)

lines = wrapper.splitlines()
if not lines or "require('./main-core.js')" not in lines[0]:
    raise SystemExit('wrapper dependency marker not found')
wrapper = '\n'.join(lines[1:]).lstrip('\n')
wrapper = wrapper.replace('module.exports = class PersistedStyleSettingsColorCycle extends Core',
                          'module.exports = class PersistedStyleSettingsColorCycle extends StyleSettingsColorCyclePlugin', 1)
if 'extends StyleSettingsColorCyclePlugin' not in wrapper:
    raise SystemExit('wrapper class replacement failed')

standalone = core.rstrip() + '\n\n' + wrapper.rstrip() + '\n'
wrapper_path.write_text(standalone, encoding='utf-8')

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['version'] = '2.4.2'
manifest['description'] = 'Плавно переходит между восемью встроенными темами Minimal, запоминает текущую позицию цикла между перезапусками Obsidian. Автономная сборка без внешних JS-зависимостей.'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
