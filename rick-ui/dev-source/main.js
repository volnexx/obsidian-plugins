const { Plugin, PluginSettingTab, Setting } = require('obsidian');

const VERSION = '0.3.1';
const DEFAULTS = {
  schemaVersion: 4,
  glow: 0.78,
  sharpness: 'cut',
  scanlines: false,
  grid: true,
  animations: true,
  accentMode: 'cyan',
  hazardAccents: true,
  segmentedControls: true,
  panelHeaders: true,
  bloom: true
};

const INLINE_VARS = {
  '--background-primary': '#000407',
  '--background-primary-alt': '#020b11',
  '--background-secondary': '#020b11',
  '--background-secondary-alt': '#05131d',
  '--interactive-accent': '#43e9ff',
  '--text-accent': '#b9fbff',
  '--background-modifier-border': 'rgba(67,233,255,.24)'
};

module.exports = class RickUIPlugin extends Plugin {
  async onload() {
    const saved = await this.loadData() || {};
    this.settings = Object.assign({}, DEFAULTS, saved, { schemaVersion: 4 });
    if (!saved.schemaVersion || saved.schemaVersion < 3) {
      this.settings.scanlines = false;
      this.settings.bloom = true;
    }

    this.runtimeStyle = null;
    this.bodyObserver = null;
    this.observedBody = null;

    this.apply();
    await this.injectStyles();

    this.app.workspace.onLayoutReady(() => {
      this.apply();
      void this.injectStyles();
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.apply()));
    this.registerDomEvent(window, 'focus', () => this.apply());

    this.addCommand({
      id: 'reapply-interface',
      name: 'Переприменить оформление',
      callback: async () => {
        this.apply();
        await this.injectStyles(true);
      }
    });

    this.addSettingTab(new RickUISettingTab(this.app, this));
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.apply();
  }

  apply() {
    const body = document.body;
    if (!body) return;

    document.documentElement.classList.add('rick-ui-root');
    document.documentElement.dataset.rickUiVersion = VERSION;
    document.documentElement.style.setProperty('--rick-glow-factor', String(this.settings.glow));

    body.classList.add('rick-ui');
    body.classList.toggle('rick-ui-scanlines', !!this.settings.scanlines);
    body.classList.toggle('rick-ui-grid', !!this.settings.grid);
    body.classList.toggle('rick-ui-animate', !!this.settings.animations);
    body.classList.toggle('rick-ui-hazards', !!this.settings.hazardAccents);
    body.classList.toggle('rick-ui-segmented', !!this.settings.segmentedControls);
    body.classList.toggle('rick-ui-panel-headers', !!this.settings.panelHeaders);
    body.classList.toggle('rick-ui-bloom', !!this.settings.bloom);
    body.dataset.rickSharpness = this.settings.sharpness;
    body.dataset.rickAccent = this.settings.accentMode;
    body.dataset.rickUiVersion = VERSION;

    for (const [name, value] of Object.entries(INLINE_VARS)) {
      body.style.setProperty(name, value, 'important');
    }

    this.watchBody(body);
  }

  watchBody(body) {
    if (this.observedBody === body) return;
    this.bodyObserver?.disconnect();
    this.observedBody = body;
    this.bodyObserver = new MutationObserver(() => {
      const current = document.body;
      if (!current) return;
      if (!current.classList.contains('rick-ui') ||
          current.dataset.rickAccent !== this.settings.accentMode ||
          current.dataset.rickSharpness !== this.settings.sharpness) {
        queueMicrotask(() => this.apply());
      }
    });
    this.bodyObserver.observe(body, {
      attributes: true,
      attributeFilter: ['class', 'data-rick-accent', 'data-rick-sharpness']
    });
  }

  async injectStyles(force = false) {
    if (this.runtimeStyle && !force) return;
    try {
      const css = await this.app.vault.adapter.read(`${this.manifest.dir}/styles.css`);
      if (!this.runtimeStyle) {
        this.runtimeStyle = document.createElement('style');
        this.runtimeStyle.id = 'rick-ui-runtime-style';
        document.head.appendChild(this.runtimeStyle);
      }
      this.runtimeStyle.textContent = css;
    } catch (error) {
      console.error('[Rick UI] Не удалось загрузить styles.css', error);
    }
  }

  onunload() {
    this.bodyObserver?.disconnect();
    this.runtimeStyle?.remove();

    const body = document.body;
    if (body) {
      body.classList.remove('rick-ui', 'rick-ui-scanlines', 'rick-ui-grid', 'rick-ui-animate',
        'rick-ui-hazards', 'rick-ui-segmented', 'rick-ui-panel-headers', 'rick-ui-bloom');
      body.removeAttribute('data-rick-sharpness');
      body.removeAttribute('data-rick-accent');
      body.removeAttribute('data-rick-ui-version');
      for (const name of Object.keys(INLINE_VARS)) body.style.removeProperty(name);
    }

    document.documentElement.classList.remove('rick-ui-root');
    document.documentElement.removeAttribute('data-rick-ui-version');
    document.documentElement.style.removeProperty('--rick-glow-factor');
  }
};

class RickUISettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const p = this.plugin;
    const c = this.containerEl;
    c.empty();
    c.createEl('h2', { text: `Rick UI ${VERSION}` });
    c.createEl('p', { text: 'Световые экраны, многослойные рамки, аппаратные элементы и аварийные состояния по интерфейсам Рика.' });

    new Setting(c).setName('Цвет системы')
      .setDesc('Основной цвет световых экранов и активных элементов.')
      .addDropdown(x => x.addOption('cyan', 'Бирюзовый').addOption('magenta', 'Пурпурный').addOption('green', 'Зелёный')
        .setValue(p.settings.accentMode).onChange(v => this.set('accentMode', v)));

    new Setting(c).setName('Сила свечения')
      .addSlider(x => x.setLimits(0, 1.25, 0.05).setDynamicTooltip().setValue(p.settings.glow)
        .onChange(v => this.set('glow', v)));

    new Setting(c).setName('Форма элементов')
      .addDropdown(x => x.addOption('cut', 'Срезанные углы').addOption('square', 'Прямые углы').addOption('soft', 'Небольшое скругление')
        .setValue(p.settings.sharpness).onChange(v => this.set('sharpness', v)));

    const toggles = [
      ['bloom', 'Световая дымка', 'Мягкое преломление внутри крупных экранов.'],
      ['hazardAccents', 'Аварийные элементы', 'Красные и янтарные состояния опасных действий.'],
      ['segmentedControls', 'Сегментированные элементы', 'Деления на кнопках, вкладках и шкалах.'],
      ['panelHeaders', 'Приборные заголовки', 'Световые полосы заголовков панелей.'],
      ['grid', 'Техническая сетка', 'Слабая сетка на вспомогательных панелях.'],
      ['scanlines', 'Строки экрана', 'Локальная текстура всплывающих экранов.'],
      ['animations', 'Анимации', 'Импульсы индикаторов и проход света.']
    ];

    for (const [key, name, desc] of toggles) {
      new Setting(c).setName(name).setDesc(desc)
        .addToggle(x => x.setValue(!!p.settings[key]).onChange(v => this.set(key, v)));
    }
  }

  async set(key, value) {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
  }
}
